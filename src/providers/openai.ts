/**
 * OpenAI Chat Completions API Provider
 *
 * Converts between the SDK's internal Anthropic-like message format
 * and OpenAI's Chat Completions API format.
 *
 * Uses native fetch (no openai SDK dependency required).
 */

import type {
  LLMProvider,
  CreateMessageParams,
  CreateMessageResponse,
  NormalizedMessageParam,
  NormalizedTool,
  NormalizedResponseBlock,
  StreamChunk,
} from './types.js'

// --------------------------------------------------------------------------
// SSE Stream Parsing
// --------------------------------------------------------------------------

const STREAM_IDLE_TIMEOUT_MS = 120_000

async function* parseSSEStream(
  response: Response,
  signal?: AbortSignal,
  onParseError?: (raw: string, error: unknown) => void,
): AsyncGenerator<any> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break

      const readResult = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) => {
          const timer = setTimeout(() => {
            resolve({ done: true, value: undefined })
          }, STREAM_IDLE_TIMEOUT_MS)
          const onAbort = () => {
            clearTimeout(timer)
            resolve({ done: true, value: undefined })
          }
          signal?.addEventListener('abort', onAbort, { once: true })
        }),
      ])

      if (readResult.done) break
      if (!readResult.value) break

      buffer += decoder.decode(readResult.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6)
          if (data === '[DONE]') return
          try {
            yield JSON.parse(data)
          } catch (err) {
            onParseError?.(data, err)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// --------------------------------------------------------------------------
// OpenAI-specific types (minimal, just what we need)
// --------------------------------------------------------------------------

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>
  reasoning_content?: string | null
  reasoning?: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

interface OpenAIChatResponse {
  id: string
  choices: Array<{
    index: number
    message: {
      role: 'assistant'
      content: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// --------------------------------------------------------------------------
// Provider
// --------------------------------------------------------------------------

export class OpenAIProvider implements LLMProvider {
  readonly apiType = 'openai-completions' as const
  private apiKey: string
  private baseURL: string

  constructor(opts: { apiKey?: string; baseURL?: string }) {
    this.apiKey = opts.apiKey || ''
    this.baseURL = (opts.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '')
  }

  async createMessage(params: CreateMessageParams): Promise<CreateMessageResponse> {
    const messages = this.convertMessages(params.system, params.messages)
    const tools = params.tools ? this.convertTools(params.tools) : undefined

    const body: Record<string, any> = {
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
    }

    if (tools && tools.length > 0) {
      body.tools = tools
    }

    if (params.thinking?.type === 'enabled') {
      body.chat_template_kwargs = { enable_thinking: true }
    }

    let imageFallback = false
    let response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    })

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')

      if (this.isImageNotSupportedError(response.status, errBody) && this.hasImageContent(messages)) {
        const strippedMessages = this.stripImageContent(messages)
        const retryBody = { ...body, messages: strippedMessages }
        response = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(retryBody),
          signal: params.signal,
        })
        if (!response.ok) {
          const retryErrBody = await response.text().catch(() => '')
          const err: any = new Error(
            `OpenAI API error: ${response.status} ${response.statusText}: ${retryErrBody}`,
          )
          err.status = response.status
          throw err
        }
        imageFallback = true
      } else {
        const err: any = new Error(
          `OpenAI API error: ${response.status} ${response.statusText}: ${errBody}`,
        )
        err.status = response.status
        throw err
      }
    }

    const data = (await response.json()) as OpenAIChatResponse

    const result = this.convertResponse(data)
    if (imageFallback) {
      result.warnings = ['Provider does not support image input; images were stripped from the request']
    }
    return result
  }

  async *createMessageStream(params: CreateMessageParams): AsyncGenerator<StreamChunk> {
    const messages = this.convertMessages(params.system, params.messages)
    const tools = params.tools ? this.convertTools(params.tools) : undefined

    const body: Record<string, any> = {
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }

    if (tools && tools.length > 0) {
      body.tools = tools
    }

    if (params.thinking?.type === 'enabled') {
      body.chat_template_kwargs = { enable_thinking: true }
    }

    let response: Response
    let imageFallback = false
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      })
    } catch (err) {
      throw err
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')

      if (this.isImageNotSupportedError(response.status, errBody) && this.hasImageContent(messages)) {
        const strippedMessages = this.stripImageContent(messages)
        const retryBody = { ...body, messages: strippedMessages }
        response = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(retryBody),
          signal: params.signal,
        })
        if (!response.ok) {
          const retryErrBody = await response.text().catch(() => '')
          const err: any = new Error(
            `OpenAI API error: ${response.status} ${response.statusText}: ${retryErrBody}`,
          )
          err.status = response.status
          throw err
        }
        imageFallback = true
      } else {
        const err: any = new Error(
          `OpenAI API error: ${response.status} ${response.statusText}: ${errBody}`,
        )
        err.status = response.status
        throw err
      }
    }

    let currentBlockIndex = -1
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
    const yieldedToolCallIndices: Set<number> = new Set()
    const parseWarnings: string[] = imageFallback
      ? ['Provider does not support image input; images were stripped from the request']
      : []

    try {
      for await (const chunk of parseSSEStream(response, params.signal, (raw, _err) => {
        parseWarnings.push(`SSE parse error, dropped chunk: ${raw.slice(0, 100)}`)
      })) {
        if (chunk.usage) {
          yield {
            type: 'usage',
            index: -1,
            warnings: parseWarnings.length > 0 ? [...parseWarnings] : undefined,
            usage: {
              input_tokens: chunk.usage.prompt_tokens || 0,
              output_tokens: chunk.usage.completion_tokens || 0,
              totalInputTokens: chunk.usage.prompt_tokens || 0,
              cache_read_input_tokens: (chunk.usage as any)?.prompt_tokens_details?.cached_tokens || undefined,
            },
          }
          parseWarnings.length = 0
        }

        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta
        if (!delta) continue

        const reasoningContent = delta.reasoning_content || delta.reasoning
        if (reasoningContent) {
          yield {
            type: 'thinking',
            index: currentBlockIndex,
            delta: reasoningContent,
          }
        }

        if (delta.content) {
          yield {
            type: 'text',
            index: currentBlockIndex,
            delta: delta.content,
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index || 0
            currentBlockIndex = index

            if (!toolCalls.has(index)) {
              toolCalls.set(index, { id: tc.id || '', name: '', arguments: '' })
            }

            const call = toolCalls.get(index)!

            if (tc.function?.name) {
              call.name += tc.function.name
            }

            if (tc.function?.arguments) {
              call.arguments += tc.function.arguments
            }

            if (tc.id) {
              call.id = tc.id
            }
          }
        }

        if (choice.finish_reason) {
          for (const [index, call] of toolCalls) {
            if (call.name && !yieldedToolCallIndices.has(index)) {
              yield {
                type: 'tool_use',
                index,
                id: call.id,
                name: call.name,
                input: call.arguments,
              }
              yieldedToolCallIndices.add(index)
            }
          }
        }
      }
    } catch (streamErr) {
      for (const [index, call] of toolCalls) {
        if (call.name && !yieldedToolCallIndices.has(index)) {
          yield {
            type: 'tool_use',
            index,
            id: call.id,
            name: call.name,
            input: call.arguments,
          }
          yieldedToolCallIndices.add(index)
        }
      }
      throw streamErr
    }

    for (const [index, call] of toolCalls) {
      if (call.name && !yieldedToolCallIndices.has(index)) {
        yield {
          type: 'tool_use',
          index,
          id: call.id,
          name: call.name,
          input: call.arguments,
        }
      }
    }

    yield { type: 'done', index: -1 }
  }

  // --------------------------------------------------------------------------
  // Image Fallback Helpers
  // --------------------------------------------------------------------------

  private isImageNotSupportedError(status: number, body: string): boolean {
    if (status !== 404 && status !== 400) return false
    const lower = body.toLowerCase()
    if (lower.includes('image') && (lower.includes('not support') || lower.includes('no endpoint'))) return true
    if (lower.includes('unknown variant') && lower.includes('image_url')) return true
    if (lower.includes('image') && lower.includes('not supported')) return true
    return false
  }

  private hasImageContent(messages: OpenAIChatMessage[]): boolean {
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image_url') return true
        }
      }
    }
    return false
  }

  private stripImageContent(messages: OpenAIChatMessage[]): OpenAIChatMessage[] {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg
      const stripped = msg.content.filter((part) => part.type !== 'image_url')
      if (stripped.length === 0) {
        return { ...msg, content: '(image content removed)' }
      }
      const textParts = stripped.filter((p) => p.type === 'text').map((p) => p.text).filter(Boolean)
      if (textParts.length > 0 && stripped.every((p) => p.type === 'text')) {
        return { ...msg, content: textParts.join('\n') }
      }
      return { ...msg, content: stripped }
    })
  }

  // --------------------------------------------------------------------------
  // Message Conversion: Internal → OpenAI
  // --------------------------------------------------------------------------

  private convertMessages(
    system: string,
    messages: NormalizedMessageParam[],
  ): OpenAIChatMessage[] {
    const result: OpenAIChatMessage[] = []

    // System prompt as first message
    if (system) {
      result.push({ role: 'system', content: system })
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        this.convertUserMessage(msg, result)
      } else if (msg.role === 'assistant') {
        this.convertAssistantMessage(msg, result)
      }
    }

    return result
  }

  private convertUserMessage(
    msg: NormalizedMessageParam,
    result: OpenAIChatMessage[],
  ): void {
    if (typeof msg.content === 'string') {
      result.push({ role: 'user', content: msg.content })
      return
    }

    const textParts: string[] = []
    const toolResults: Array<{ tool_use_id: string; content: string }> = []
    const mediaAttachments: Array<{ mime: string; data: string }> = []

    const blockTypes = (msg.content as any[]).map((b: any) => b.type)

    for (const block of msg.content) {
      if (block.type === 'text') {
        textParts.push(block.text)
      } else if (block.type === 'image' && (block as any).source?.type === 'base64') {
        mediaAttachments.push({ mime: (block as any).source.media_type, data: (block as any).source.data })
      } else if (block.type === 'tool_result') {
        if (Array.isArray(block.content)) {
          const textFromBlocks: string[] = []
          for (const b of block.content as any[]) {
            if (b.type === 'text') {
              textFromBlocks.push(b.text)
            } else if (b.type === 'image' && b.source?.type === 'base64') {
              mediaAttachments.push({ mime: b.source.media_type, data: b.source.data })
            }
          }
          toolResults.push({
            tool_use_id: block.tool_use_id,
            content: textFromBlocks.join('\n') || '(media content)',
          })
        } else {
          toolResults.push({
            tool_use_id: block.tool_use_id,
            content: block.content,
          })
        }
      }
    }

    // Tool results become separate tool messages
    for (const tr of toolResults) {
      result.push({
        role: 'tool',
        tool_call_id: tr.tool_use_id,
        content: tr.content,
      })
    }

    // Text parts become a user message
    if (textParts.length > 0) {
      result.push({ role: 'user', content: textParts.join('\n') })
    }

    if (mediaAttachments.length > 0) {
      const userParts: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = [
        { type: 'text', text: 'Attached image(s) from tool result:' },
      ]
      for (const att of mediaAttachments) {
        userParts.push({
          type: 'image_url',
          image_url: { url: `data:${att.mime};base64,${att.data}` },
        })
      }
      result.push({ role: 'user', content: userParts })
    }
  }

  private convertAssistantMessage(
    msg: NormalizedMessageParam,
    result: OpenAIChatMessage[],
  ): void {
    if (typeof msg.content === 'string') {
      result.push({ role: 'assistant', content: msg.content })
      return
    }

    const textParts: string[] = []
    const toolCalls: OpenAIToolCall[] = []
    const thinkingParts: string[] = []

    for (const block of msg.content) {
      if (block.type === 'text') {
        textParts.push(block.text)
      } else if (block.type === 'thinking') {
        thinkingParts.push((block as any).thinking || '')
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input),
          },
        })
      }
    }

    const assistantMsg: OpenAIChatMessage = {
      role: 'assistant',
      content: textParts.length > 0 ? textParts.join('\n') : null,
    }

    if (toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls
    }

    if (thinkingParts.length > 0) {
      assistantMsg.reasoning_content = thinkingParts.join('\n')
    }

    result.push(assistantMsg)
  }

  // --------------------------------------------------------------------------
  // Tool Conversion: Internal → OpenAI
  // --------------------------------------------------------------------------

  private convertTools(tools: NormalizedTool[]): OpenAITool[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))
  }

  // --------------------------------------------------------------------------
  // Response Conversion: OpenAI → Internal
  // --------------------------------------------------------------------------

  private convertResponse(data: OpenAIChatResponse): CreateMessageResponse {
    const choice = data.choices[0]
    if (!choice) {
      return {
        content: [{ type: 'text', text: '' }],
        stopReason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0, totalInputTokens: 0 },
      }
    }

    const content: NormalizedResponseBlock[] = []

    // Add thinking content (before text, matches streaming order)
    const reasoningContent = choice.message.reasoning_content || choice.message.reasoning
    if (reasoningContent) {
      content.push({ type: 'thinking', thinking: reasoningContent })
    }

    // Add text content
    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content })
    }

    // Add tool calls
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: any
        try {
          input = JSON.parse(tc.function.arguments)
        } catch {
          input = tc.function.arguments
        }

        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        })
      }
    }

    // If no content at all, add empty text
    if (content.length === 0) {
      content.push({ type: 'text', text: '' })
    }

    // Map finish_reason to our normalized stop reasons
    const stopReason = this.mapFinishReason(choice.finish_reason)

    return {
      content,
      stopReason,
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
        totalInputTokens: data.usage?.prompt_tokens || 0,
        cache_read_input_tokens: (data.usage as any)?.prompt_tokens_details?.cached_tokens || undefined,
      },
    }
  }

  private mapFinishReason(
    reason: string,
  ): 'end_turn' | 'max_tokens' | 'tool_use' | string {
    switch (reason) {
      case 'stop':
        return 'end_turn'
      case 'length':
        return 'max_tokens'
      case 'tool_calls':
        return 'tool_use'
      default:
        return reason
    }
  }
}
