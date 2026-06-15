/**
 * QueryEngine - Core agentic loop
 *
 * Manages the full conversation lifecycle:
 * 1. Take user prompt
 * 2. Build system prompt with context (git status, project context, tools)
 * 3. Call LLM API with tools (via provider abstraction)
 * 4. Stream response
 * 5. Execute tool calls (concurrent for read-only, serial for mutations)
 * 6. Send results back, repeat until done
 * 7. Auto-compact when context exceeds threshold
 * 8. Retry with exponential backoff on transient errors
 */

export const DEFAULT_MAX_TOKENS = 64 * 1024
export const MAX_TOKENS_NON_STREAMING = 16 * 1024

import type {
  SDKMessage,
  SDKSubagentMessage,
  SDKCompactMessage,
  QueryEngineConfig,
  ToolDefinition,
  ToolResult,
  ToolContext,
  TokenUsage,
} from './types.js'
import type {
  LLMProvider,
  CreateMessageResponse,
  NormalizedMessageParam,
  NormalizedTool,
} from './providers/types.js'
import {
  estimateCost,
  DEFAULT_MAX_REQUEST_BODY_BYTES,
} from './utils/tokens.js'
import { enforceBodySizeLimit } from './utils/body-size.js'
import {
  shouldAutoCompact,
  compactConversation,
  compactConversationWithProtectedTail,
  microCompactMessages,
  pruneMessages,
  createAutoCompactState,
  type AutoCompactState,
} from './utils/compact.js'
import {
  withRetry,
  isPromptTooLongError,
} from './utils/retry.js'
import { getSystemContext } from './utils/context.js'
import { normalizeMessagesForAPI } from './utils/messages.js'
import type { HookRegistry, HookInput, HookOutput } from './hooks.js'
import { formatSkillsForSystemPrompt, getUserInvocableSkills, filterSkillsByAllowlist } from './skills/registry.js'
import { SYSTEM_PROMPTS } from './prompts/system-prompts.js'
import { loadAgentsMd } from './utils/agents-md.js'

// ============================================================================
// Tool format conversion
// ============================================================================

/** Convert a ToolDefinition to the normalized provider tool format. */
function toProviderTool(tool: ToolDefinition): NormalizedTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }
}

// ============================================================================
// ToolUseBlock (internal type for extracted tool_use blocks)
// ============================================================================

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: any
}

// ============================================================================
// System Prompt Builder
// ============================================================================

async function buildEnvironmentPrompt(config: QueryEngineConfig): Promise<string> {
  const parts: string[] = []

  // Environment block (<env> XML with model identity, platform, date, etc.)
  try {
    const sysCtx = await getSystemContext(config.cwd, config.model)
    if (sysCtx) parts.push(sysCtx)
  } catch {
    // Context is best-effort
  }

  // Add skills — verbose XML format builds a complete cognitive map for the model
  const allSkills = getUserInvocableSkills()
  const filteredSkills = filterSkillsByAllowlist(allSkills, config.allowedSkills)
  const skillsXml = formatSkillsForSystemPrompt(filteredSkills)
  if (skillsXml) {
    parts.push('\nSkills provide specialized instructions and workflows for specific tasks.')
    parts.push('Use the skill tool to load a skill when a task matches its description.\n')
    parts.push(skillsXml)
  }

  // Add subagent definitions — XML format aligned with skills
  if (config.agents && Object.keys(config.agents).length > 0) {
    const agentEntries = Object.entries(config.agents).sort((a, b) => a[0].localeCompare(b[0]))
    const agentXml = agentEntries.map(([name, def]) => [
      '  <subagent>',
      `    <name>${name}</name>`,
      `    <description>${def.description}</description>`,
      '  </subagent>',
    ].join('\n'))
    parts.push([
      '<available_subagents>',
      ...agentXml,
      '</available_subagents>',
    ].join('\n'))
  }

  // Load AGENTS.md instructions
  const agentsMdContent = await loadAgentsMd(config.cwd, config.settingSources)
  if (agentsMdContent) {
    parts.push('\n# Instructions\n')
    parts.push(agentsMdContent)
  }

  return parts.join('\n')
}

async function buildSystemPrompt(config: QueryEngineConfig): Promise<string> {
  const basePrompt = config.systemPrompt || SYSTEM_PROMPTS.default
  const envPrompt = await buildEnvironmentPrompt(config)

  let result = basePrompt + '\n\n' + envPrompt

  if (config.appendSystemPrompt) {
    result += '\n\n' + config.appendSystemPrompt
  }

  return result
}

// ============================================================================
// QueryEngine
// ============================================================================

export class QueryEngine {
  private config: QueryEngineConfig
  private provider: LLMProvider
  public messages: NormalizedMessageParam[] = []
  private totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
  private totalCost = 0
  private turnCount = 0
  private compactState: AutoCompactState
  private sessionId: string
  private apiTimeMs = 0
  private hookRegistry?: HookRegistry

  constructor(config: QueryEngineConfig, initialUsage?: { lastInputTokens?: number; lastOutputTokens?: number }) {
    this.config = config
    this.provider = config.provider
    this.compactState = createAutoCompactState()
    if (initialUsage?.lastInputTokens) {
      this.compactState.lastInputTokens = initialUsage.lastInputTokens
    }
    if (initialUsage?.lastOutputTokens) {
      this.compactState.lastOutputTokens = initialUsage.lastOutputTokens
    }
    this.sessionId = config.sessionId || crypto.randomUUID()
    this.hookRegistry = config.hookRegistry
  }

  /**
   * Build complete response from stream chunks
   */
  private buildResponseFromChunks(chunks: import('./providers/types.js').StreamChunk[]): CreateMessageResponse {
    const content: import('./providers/types.js').NormalizedResponseBlock[] = []
    let currentBlock: import('./providers/types.js').NormalizedResponseBlock | null = null
    const toolUses: Map<number, { id: string; name: string; input: string }> = new Map()

    for (const chunk of chunks) {
      if (chunk.type === 'done') continue

      if (chunk.type === 'text') {
        if (!currentBlock || currentBlock.type !== 'text') {
          currentBlock = { type: 'text', text: chunk.delta || '' }
          content.push(currentBlock)
        } else {
          currentBlock.text += chunk.delta || ''
        }
      }

      if (chunk.type === 'thinking') {
        if (!currentBlock || currentBlock.type !== 'thinking') {
          currentBlock = { type: 'thinking', thinking: chunk.delta || '' }
          content.push(currentBlock)
        } else {
          currentBlock.thinking += chunk.delta || ''
        }
      }

      if (chunk.type === 'tool_use') {
        const toolUse = toolUses.get(chunk.index) || { id: '', name: '', input: '' }
        if (chunk.id) {
          toolUse.id = chunk.id
        }
        if (chunk.name) {
          toolUse.name = chunk.name
        }
        if (chunk.input !== undefined && chunk.input !== '') {
          toolUse.input += chunk.input
        }
        toolUses.set(chunk.index, toolUse)
      }
    }

    for (const [index, toolUse] of toolUses) {
      if (toolUse.name) {
        let input: any
        if (toolUse.input) {
          try {
            input = JSON.parse(toolUse.input)
          } catch {
            input = toolUse.input
          }
        } else {
          input = {}
        }
        content.push({
          type: 'tool_use',
          id: toolUse.id || `tool_${index}`,
          name: toolUse.name,
          input,
        })
      }
    }

    // Determine stop reason based on content
    const hasToolUse = content.some(block => block.type === 'tool_use')
    const hasText = content.some(block => block.type === 'text')

    return {
      content,
      stopReason: hasToolUse ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0, totalInputTokens: 0 },
    }
  }

  /**
   * Execute hooks for a lifecycle event.
   * Returns hook outputs; never throws.
   */
  private async executeHooks(
    event: import('./hooks.js').HookEvent,
    extra?: Partial<HookInput>,
  ): Promise<HookOutput[]> {
    if (!this.hookRegistry?.hasHooks(event)) return []
    try {
      return await this.hookRegistry.execute(event, {
        event,
        sessionId: this.sessionId,
        cwd: this.config.cwd,
        ...extra,
      })
    } catch {
      return []
    }
  }

  /**
   * Submit a user message and run the agentic loop.
   * Yields SDKMessage events as the agent works.
   */
  async *submitMessage(
    prompt: string | any[],
  ): AsyncGenerator<SDKMessage> {
    // Hook: SessionStart
    await this.executeHooks('SessionStart')

    // Hook: UserPromptSubmit
    const userHookResults = await this.executeHooks('UserPromptSubmit', {
      toolInput: prompt,
    })
    // Check if any hook blocks the submission
    if (userHookResults.some((r) => r.block)) {
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        usage: { ...this.totalUsage },
        num_turns: 0,
        cost: 0,
        errors: ['Blocked by UserPromptSubmit hook'],
      }
      return
    }

    // Add user message
    this.messages.push({ role: 'user', content: prompt as any })

    // Build tool definitions for provider
    const tools = this.config.tools.map(toProviderTool)

    // Build system prompt
    const systemPrompt = await buildSystemPrompt(this.config)

    // Emit init system message
    const allSkills = getUserInvocableSkills()
    const filteredSkills = filterSkillsByAllowlist(allSkills, this.config.allowedSkills)
    yield {
      type: 'system',
      subtype: 'init',
      session_id: this.sessionId,
      tools: this.config.tools.map(t => t.name),
      skills: filteredSkills.map(s => s.name),
      model: this.config.model,
      cwd: this.config.cwd,
      mcp_servers: [],
      permission_mode: 'bypassPermissions',
      system_prompt: systemPrompt,
    } as SDKMessage

    // Agentic loop
    let turnsRemaining = this.config.maxTurns
    let budgetExceeded = false
    let maxOutputRecoveryAttempts = 0
    const MAX_OUTPUT_RECOVERY = 3

    while (turnsRemaining > 0) {
      if (this.config.abortSignal?.aborted) break

      // Check budget
      if (this.config.maxBudgetUsd && this.totalCost >= this.config.maxBudgetUsd) {
        budgetExceeded = true
        break
      }

      // Auto-compact if context is too large
      if (shouldAutoCompact(this.compactState, this.config.model, this.config.contextWindow)) {
        for await (const ev of this.compactStream()) {
          yield ev
        }
      }

      // Micro-compact: truncate large tool results
      let apiMessages = microCompactMessages(
        normalizeMessagesForAPI(this.messages as any[]),
      ) as NormalizedMessageParam[]

      // Enforce request body size limit: strip images from oldest messages if needed
      const maxBodyBytes = this.config.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
      const bodySizeResult = enforceBodySizeLimit(apiMessages, maxBodyBytes, systemPrompt)
      apiMessages = bodySizeResult.messages as NormalizedMessageParam[]
      if (bodySizeResult.strippedCount > 0) {
        this.messages = apiMessages
        yield {
          type: 'system',
          subtype: 'warning',
          message: `Request body exceeded ${maxBodyBytes} byte limit. ${bodySizeResult.strippedCount} image(s) removed from older messages.`,
        } as any
      }

      this.turnCount++
      turnsRemaining--

      // Make API call with retry via provider
      let response: CreateMessageResponse
      const apiStart = performance.now()

      try {
        if (this.config.includePartialMessages) {
          // Check if provider supports streaming
          if (!this.provider.createMessageStream) {
            throw new Error('Streaming not supported by this provider')
          }

          const chunks: import('./providers/types.js').StreamChunk[] = []
          const streamUsage: any = { input_tokens: 0, output_tokens: 0, totalInputTokens: 0 }
          const seenToolUseIndices = new Set<number>()

          try {
            for await (const chunk of this.provider.createMessageStream({
              model: this.config.model,
              maxTokens: this.config.maxTokens,
              system: systemPrompt,
              messages: apiMessages,
              tools: tools.length > 0 ? tools : undefined,
              thinking:
                this.config.thinking?.type === 'enabled'
                  ? {
                    type: 'enabled',
                    budget_tokens: this.config.thinking.budgetTokens,
                  }
                  : undefined,
              signal: this.config.abortSignal,
            })) {
              if (this.config.abortSignal?.aborted) break

              chunks.push(chunk)

              if (chunk.warnings && chunk.warnings.length > 0) {
                for (const w of chunk.warnings) {
                  yield { type: 'system', subtype: 'warning', message: w } as any
                }
              }

              if (chunk.type === 'usage' && chunk.usage) {
                streamUsage.input_tokens = chunk.usage.input_tokens
                streamUsage.output_tokens = chunk.usage.output_tokens
                streamUsage.totalInputTokens = chunk.usage.totalInputTokens || chunk.usage.input_tokens
                streamUsage.cache_creation_input_tokens = chunk.usage.cache_creation_input_tokens
                streamUsage.cache_read_input_tokens = chunk.usage.cache_read_input_tokens
                if (chunk.rawUsage) {
                  streamUsage.rawUsage = chunk.rawUsage
                }
              }

              if (chunk.type === 'tool_use') {
                if (!seenToolUseIndices.has(chunk.index)) {
                  seenToolUseIndices.add(chunk.index)
                  yield {
                    type: 'partial_message',
                    partial: {
                      type: 'tool_use',
                      tool_name: chunk.name || '',
                      tool_use_id: chunk.id || '',
                    },
                  }
                }
              }

              if (chunk.type === 'text' || chunk.type === 'thinking') {
                yield {
                  type: 'partial_message',
                  partial: {
                    type: chunk.type,
                    text: chunk.delta || '',
                  },
                }
              }
            }
          } catch (err: any) {
            if (this.config.abortSignal?.aborted && chunks.length > 0) {
              // Provider threw on abort but we have partial content — fall through
            } else {
              throw err
            }
          }

          response = this.buildResponseFromChunks(chunks)
          if (streamUsage.input_tokens > 0 || streamUsage.output_tokens > 0) {
            response.usage = streamUsage
          }
          if (streamUsage.rawUsage) {
            response.rawUsage = streamUsage.rawUsage
          }
        } else {
          // Non-streaming mode
          response = await withRetry(
            async () => {
              return this.provider.createMessage({
                model: this.config.model,
                maxTokens: Math.min(this.config.maxTokens, MAX_TOKENS_NON_STREAMING),
                system: systemPrompt,
                messages: apiMessages,
                tools: tools.length > 0 ? tools : undefined,
                thinking:
                  this.config.thinking?.type === 'enabled'
                    ? {
                      type: 'enabled',
                      budget_tokens: this.config.thinking.budgetTokens,
                    }
                    : undefined,
              })
            },
            undefined,
            this.config.abortSignal,
          )

          if (response.warnings && response.warnings.length > 0) {
            for (const w of response.warnings) {
              yield { type: 'system', subtype: 'warning', message: w } as any
            }
          }
        }
      } catch (err: any) {
        // Handle prompt-too-long by compacting
        if (isPromptTooLongError(err) && !this.compactState.compacted) {
          try {
            const result = await compactConversation(
              this.provider,
              this.config.model,
              this.messages as any[],
              this.compactState,
            )
            this.messages = result.compactedMessages as NormalizedMessageParam[]
            this.compactState = result.state
            turnsRemaining++ // Retry this turn
            this.turnCount--
            continue
          } catch {
            // Can't compact, give up
          }
        }

        yield {
          type: 'result',
          subtype: 'error',
          usage: { ...this.totalUsage },
          num_turns: this.turnCount,
          cost: this.totalCost,
          errors: [err.message],
        }
        return
      }

      // Track API timing
      this.apiTimeMs += performance.now() - apiStart

      // Track usage (normalized by provider)
      if (response.usage) {
        this.totalUsage.input_tokens = response.usage.input_tokens
        this.totalUsage.output_tokens = response.usage.output_tokens
        this.totalUsage.cache_creation_input_tokens = response.usage.cache_creation_input_tokens
        this.totalUsage.cache_read_input_tokens = response.usage.cache_read_input_tokens
        this.totalUsage.total_input_tokens = response.usage.totalInputTokens
        this.totalCost += estimateCost(this.config.model, response.usage)
        this.compactState.lastInputTokens = response.usage.totalInputTokens || response.usage.input_tokens
        this.compactState.lastOutputTokens = response.usage.output_tokens
      }

      pruneMessages(this.messages)

      // Add assistant message to conversation
      this.messages.push({ role: 'assistant', content: response.content as any, rawUsage: response.rawUsage })

      // Yield assistant message
      yield {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: response.content as any,
        },
        usage: response.usage,
      }

      // Handle max_output_tokens recovery
      if (response.stopReason === 'max_tokens' && maxOutputRecoveryAttempts < MAX_OUTPUT_RECOVERY) {
        const hasToolUse = response.content.some((b: any) => b.type === 'tool_use')

        if (hasToolUse) {
          yield {
            type: 'system',
            subtype: 'warning',
            message: `Output truncated (max_tokens). Tool call(s) may have incomplete arguments.`,
          } as any
        } else {
          yield {
            type: 'system',
            subtype: 'warning',
            message: `Output truncated (max_tokens). Text response was cut off.`,
          } as any
          maxOutputRecoveryAttempts++
          this.messages.push({
            role: 'user',
            content: 'Please continue from where you left off.',
          })
          continue
        }
      }

      // Check for tool use
      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use',
      )

      if (toolUseBlocks.length === 0) {
        break // No tool calls - agent is done
      }

      // Reset max_output recovery counter on successful tool use
      maxOutputRecoveryAttempts = 0

      // Real-time subagent event streaming via async queue
      const pendingSubagentEvents: SDKSubagentMessage[] = []
      let eventNotifier: (() => void) | null = null
      let toolsDone = false

      const enqueueSubagentEvent = (event: SDKSubagentMessage) => {
        pendingSubagentEvents.push(event)
        eventNotifier?.()
        eventNotifier = null
      }

      const waitForEventOrDone = (): Promise<void> =>
        new Promise((resolve) => {
          if (pendingSubagentEvents.length > 0 || toolsDone) return resolve()
          if (this.config.abortSignal?.aborted) return resolve()

          eventNotifier = resolve
          const onAbort = () => {
            eventNotifier = null
            resolve()
          }
          this.config.abortSignal?.addEventListener('abort', onAbort, { once: true })

          const origNotifier = eventNotifier
          eventNotifier = () => {
            this.config.abortSignal?.removeEventListener('abort', onAbort)
            origNotifier?.()
          }
        })

      let toolError: Error | null = null

      const toolPromise = this.executeTools(toolUseBlocks, enqueueSubagentEvent)
        .then((results) => {
          toolsDone = true
          eventNotifier?.()
          eventNotifier = null
          return results
        })
        .catch((err: Error) => {
          toolError = err
          toolsDone = true
          eventNotifier?.()
          eventNotifier = null
          return [] as (ToolResult & { tool_name?: string })[]
        })

      // Yield subagent events as they arrive, in real-time
      while (!toolsDone || pendingSubagentEvents.length > 0) {
        if (this.config.abortSignal?.aborted) break
        if (pendingSubagentEvents.length > 0) {
          yield pendingSubagentEvents.shift()!
          continue
        }
        if (toolsDone) break
        await waitForEventOrDone()
      }

      const toolResults = await toolPromise

      if (toolError) {
        throw toolError
      }

      // Fill in missing tool results for tools skipped due to abort.
      // This ensures every tool_use block has a matching tool_result in the transcript.
      if (this.config.abortSignal?.aborted) {
        const completedIds = new Set(toolResults.map(r => r.tool_use_id))
        for (const block of toolUseBlocks) {
          if (!completedIds.has(block.id)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: 'Tool execution aborted by user',
              is_error: true,
              tool_name: block.name,
            })
          }
        }
      }

      // Add tool results to conversation BEFORE yielding, so that if the
      // generator is force-returned during yield, messages are already persisted.
      this.messages.push({
        role: 'user',
        content: toolResults.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.tool_use_id,
          content: r.content,
          is_error: r.is_error,
        })),
      })

      // Sanitize assistant message: ensure tool_use input is an object (not raw string)
      // so the API accepts it on subsequent turns. Must happen BEFORE any yield to
      // guarantee the transcript is consistent even if generator is force-returned.
      const assistantMsg = this.messages[this.messages.length - 2]
      if (assistantMsg?.role === 'assistant' && Array.isArray(assistantMsg.content)) {
        for (const block of assistantMsg.content as any[]) {
          if (block.type === 'tool_use' && typeof block.input === 'string') {
            block.input = {}
          }
        }
      }

      // Now safe to yield — all state is persisted

      // Yield warning if any tool call had truncated input
      const truncatedCount = toolUseBlocks.filter((b) => typeof b.input === 'string').length
      if (truncatedCount > 0) {
        yield {
          type: 'system',
          subtype: 'warning',
          message: `Output truncated. ${truncatedCount} tool call(s) had incomplete/unparseable JSON arguments.`,
        } as any
      }

      // Yield tool results
      for (const result of toolResults) {
        yield {
          type: 'tool_result',
          result: {
            tool_use_id: result.tool_use_id,
            tool_name: result.tool_name || '',
            output:
              typeof result.content === 'string'
                ? result.content
                : Array.isArray(result.content)
                  ? (result.content as any[]).map((b: any) => b.type === 'text' ? b.text : `[${b.type}]`).join('\n')
                  : JSON.stringify(result.content),
          },
        }
      }

      if (response.stopReason === 'end_turn') break
    }

    // Hook: Stop (end of agentic loop)
    await this.executeHooks('Stop')

    // Hook: SessionEnd
    await this.executeHooks('SessionEnd')

    // Yield enriched final result
    const endSubtype = budgetExceeded
      ? 'error_max_budget_usd'
      : turnsRemaining <= 0
        ? 'error_max_turns'
        : 'success'

    yield {
      type: 'result',
      subtype: endSubtype,
      session_id: this.sessionId,
      is_error: endSubtype !== 'success',
      num_turns: this.turnCount,
      total_cost_usd: this.totalCost,
      duration_api_ms: Math.round(this.apiTimeMs),
      usage: { ...this.totalUsage },
      model_usage: { [this.config.model]: { input_tokens: this.totalUsage.input_tokens, output_tokens: this.totalUsage.output_tokens } },
      cost: this.totalCost,
    }
  }

  /**
   * Execute tool calls with concurrency control.
   *
   * Read-only tools run concurrently (up to 10 at a time).
   * Mutation tools run sequentially.
   */
  private async executeTools(
    toolUseBlocks: ToolUseBlock[],
    emitSubagentEvent?: (event: SDKSubagentMessage) => void,
  ): Promise<(ToolResult & { tool_name?: string })[]> {
    const MAX_CONCURRENCY = parseInt(
      process.env.AGENT_SDK_MAX_TOOL_CONCURRENCY || '10',
    )

    // Partition into read-only (concurrent) and mutation (serial)
    const readOnly: Array<{ block: ToolUseBlock; tool?: ToolDefinition }> = []
    const mutations: Array<{ block: ToolUseBlock; tool?: ToolDefinition }> = []

    for (const block of toolUseBlocks) {
      const tool = this.config.tools.find((t) => t.name === block.name)
      if (tool?.isReadOnly?.()) {
        readOnly.push({ block, tool })
      } else {
        mutations.push({ block, tool })
      }
    }

    const results: (ToolResult & { tool_name?: string })[] = []

    const makeContext = (block: ToolUseBlock): ToolContext => ({
      cwd: this.config.cwd,
      abortSignal: this.config.abortSignal,
      provider: this.provider,
      model: this.config.model,
      apiType: this.provider.apiType,
      maxTokens: this.config.maxTokens,
      agentId: this.config.agentId,
      sessionId: this.sessionId,
      allowedSkills: this.config.allowedSkills,
      settingSources: this.config.settingSources,
      emitEvent: emitSubagentEvent
        ? (event: SDKMessage) => {
            if (event.type === 'subagent') {
              emitSubagentEvent({
                ...event,
                parent_tool_use_id: block.id,
              })
            }
          }
        : undefined,
    })

    // Execute read-only tools concurrently (batched by MAX_CONCURRENCY)
    for (let i = 0; i < readOnly.length; i += MAX_CONCURRENCY) {
      if (this.config.abortSignal?.aborted) break
      const batch = readOnly.slice(i, i + MAX_CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map((item) =>
          this.executeSingleTool(item.block, item.tool, makeContext(item.block)),
        ),
      )
      results.push(...batchResults)
    }

    // Execute mutation tools sequentially
    for (const item of mutations) {
      if (this.config.abortSignal?.aborted) break
      const result = await this.executeSingleTool(item.block, item.tool, makeContext(item.block))
      results.push(result)
    }

    return results
  }

  /**
   * Execute a single tool with permission checking.
   */
  private async executeSingleTool(
    block: ToolUseBlock,
    tool: ToolDefinition | undefined,
    context: ToolContext,
  ): Promise<ToolResult & { tool_name?: string }> {
    if (!tool) {
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Error: Unknown tool "${block.name}"`,
        is_error: true,
        tool_name: block.name,
      }
    }

    // Validate input: must be an object (not a raw string from failed JSON parse)
    if (typeof block.input === 'string') {
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: [
          `Tool call "${block.name}" failed — input is not valid JSON.`,
          '',
          'Raw input (first 500 chars):',
          block.input.slice(0, 500),
          '',
          'This usually happens when maxTokens is too low and the response was truncated.',
          'Please try again with shorter content, or break the task into smaller steps.',
        ].join('\n'),
        is_error: true,
        tool_name: block.name,
      }
    }

    // Check enabled
    if (tool.isEnabled && !tool.isEnabled()) {
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Error: Tool "${block.name}" is not enabled`,
        is_error: true,
        tool_name: block.name,
      }
    }

    // Check permissions
    if (this.config.canUseTool) {
      try {
        const permission = await this.config.canUseTool(tool, block.input)
        if (permission.behavior === 'deny') {
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: permission.message || [
              `Permission denied: the user rejected execution of tool "${block.name}".`,
              '',
              'Consider why the tool call was denied:',
              '- If the tool call parameters seem correct, try rephrasing or adjusting your approach instead of repeating the same call.',
              "- If you're unsure why the call was denied, ask the user for clarification.",
              '- If the task can be accomplished through an alternative method, try that approach instead.',
              '',
              'Do NOT retry the exact same tool call with identical parameters.',
            ].join('\n'),
            is_error: true,
            tool_name: block.name,
          }
        }
        if (permission.updatedInput !== undefined) {
          block = { ...block, input: permission.updatedInput }
        }
      } catch (err: any) {
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Permission check error: ${err.message}`,
          is_error: true,
          tool_name: block.name,
        }
      }
    }

    // Hook: PreToolUse
    const preHookResults = await this.executeHooks('PreToolUse', {
      toolName: block.name,
      toolInput: block.input,
      toolUseId: block.id,
    })
    // Check if any hook blocks this tool
    if (preHookResults.some((r) => r.block)) {
      const hookMsg = preHookResults.find((r) => r.message)?.message
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: [
          `Blocked by PreToolUse hook: ${hookMsg || 'no reason provided'}`,
          '',
          'This tool call was blocked by a user-configured hook. Consider:',
          '- Adjusting your approach to avoid triggering the hook.',
          '- Asking the user to check their hooks configuration if this is unexpected.',
        ].join('\n'),
        is_error: true,
        tool_name: block.name,
      }
    }

    // Validate tool input: check required fields exist
    if (block.input && typeof block.input === 'object' && tool.inputSchema?.required) {
      const input = block.input as Record<string, unknown>
      const missing = tool.inputSchema.required.filter(
        (key) => input[key] === undefined || input[key] === null,
      )
      if (missing.length > 0) {
        await this.executeHooks('PostToolUseFailure', {
          toolName: block.name,
          toolInput: block.input,
          toolUseId: block.id,
          error: `Missing required fields: ${missing.join(', ')}`,
        })
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: [
            `Tool input validation failed for "${block.name}":`,
            `Missing required fields: ${missing.join(', ')}`,
            '',
            'Input was:',
            JSON.stringify(block.input, null, 2).slice(0, 2000),
            '',
            'Please fix the input and try again.',
          ].join('\n'),
          is_error: true,
          tool_name: block.name,
        }
      }
    }

    // Execute the tool
    try {
      const result = await tool.call(block.input, context)

      // Hook: PostToolUse
      await this.executeHooks('PostToolUse', {
        toolName: block.name,
        toolInput: block.input,
        toolOutput: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        toolUseId: block.id,
      })

      return { ...result, tool_use_id: block.id, tool_name: block.name }
    } catch (err: any) {
      // Hook: PostToolUseFailure
      await this.executeHooks('PostToolUseFailure', {
        toolName: block.name,
        toolInput: block.input,
        toolUseId: block.id,
        error: err.message,
      })

      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Tool execution error: ${err.message}`,
        is_error: true,
        tool_name: block.name,
      }
    }
  }

  /**
   * Get current messages for session persistence.
   */
  getMessages(): NormalizedMessageParam[] {
    return [...this.messages]
  }

  getUsage(): TokenUsage {
    return { ...this.totalUsage }
  }

  /**
   * Get total cost.
   */
  getCost(): number {
    return this.totalCost
  }

  /**
   * Get current compact state for persistence.
   */
  getState(): { lastInputTokens: number; lastOutputTokens: number } {
    return {
      lastInputTokens: this.compactState.lastInputTokens,
      lastOutputTokens: this.compactState.lastOutputTokens,
    }
  }

  /**
   * Manually trigger compaction of the current conversation.
   *
   * Summarizes older history while protecting the most recent turns, firing
   * PreCompact/PostCompact hooks. Streams `compact` events (start/progress/end)
   * so callers can surface progress (e.g. a `/compact` command). This is the
   * same algorithm used by auto-compaction, so behavior is identical.
   */
  async *compactStream(): AsyncGenerator<SDKCompactMessage> {
    await this.executeHooks('PreCompact')
    try {
      const gen = compactConversationWithProtectedTail(
        this.provider,
        this.config.model,
        this.messages,
        this.compactState,
      )
      while (true) {
        const next = await gen.next()
        if (next.done) {
          this.messages = next.value.messages
          this.compactState = next.value.state
          break
        }
        yield next.value
      }
      await this.executeHooks('PostCompact')
    } catch {
      // Leave messages unchanged on failure; skip PostCompact
    }
  }

  /**
   * Manually trigger compaction (non-streaming convenience wrapper).
   *
   * Consumes `compactStream()` and returns the resulting summary. Useful when a
   * caller does not need incremental progress events.
   */
  async compact(): Promise<{ summary: string; compacted: boolean }> {
    let summary = ''
    for await (const ev of this.compactStream()) {
      if (ev.type === 'compact' && ev.phase === 'end') {
        summary = ev.summary ?? ''
      }
    }
    return { summary, compacted: summary.length > 0 }
  }
}
