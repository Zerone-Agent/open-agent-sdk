/**
 * Context Compression / Auto-Compaction
 *
 * Summarizes long conversation histories when context window fills up.
 * Three-tier system:
 * 1. Pruning: replace old large tool results with placeholder
 * 2. Auto-compact: triggered when tokens exceed threshold
 * 3. Micro-compact: cache-aware per-request optimization
 */

import type { LLMProvider } from '../providers/types.js'
import type { NormalizedMessageParam } from '../providers/types.js'
import type { SDKCompactMessage } from '../types.js'
import {
  getAutoCompactThreshold,
} from './tokens.js'

export const PRUNE_PROTECTED_TURNS = 2
export const PRUNE_THRESHOLD_CHARS = 20_000

export interface AutoCompactState {
  compacted: boolean
  turnCounter: number
  consecutiveFailures: number
  lastInputTokens: number
  lastOutputTokens: number
}

export function createAutoCompactState(): AutoCompactState {
  return {
    compacted: false,
    turnCounter: 0,
    consecutiveFailures: 0,
    lastInputTokens: 0,
    lastOutputTokens: 0,
  }
}

export function shouldAutoCompact(
  state: AutoCompactState,
  model: string,
  contextWindow?: number,
): boolean {
  if (state.consecutiveFailures >= 3) return false
  if (state.lastInputTokens <= 0) return false

  const threshold = getAutoCompactThreshold(model, contextWindow)
  const conversationTokens = state.lastInputTokens + state.lastOutputTokens

  return conversationTokens >= threshold
}

/**
 * Compact conversation by summarizing with the LLM.
 *
 * Sends the entire conversation to the LLM for summarization,
 * then replaces the history with a compact summary.
 */
const COMPACT_SYSTEM_PROMPT = `You are a conversation summarizer. When constructing the summary, stick to this template:

## Goal
[What goal(s) is the user trying to accomplish?]

## Instructions
- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries
[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished
[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories
[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]

The summary should allow the conversation to continue seamlessly.`

function buildCompactedMessages(summary: string): NormalizedMessageParam[] {
  return [
    {
      role: 'user',
      content: `[Previous conversation summary]\n\n${summary}\n\n[End of summary - conversation continues below]`,
    },
    {
      role: 'assistant',
      content: 'I understand the context from the previous conversation. I\'ll continue from where we left off.',
    },
  ]
}

export interface CompactResult {
  compactedMessages: NormalizedMessageParam[]
  summary: string
  state: AutoCompactState
}

export async function* compactConversationStream(
  provider: LLMProvider,
  model: string,
  messages: any[],
  state: AutoCompactState,
  debug?: boolean,
): AsyncGenerator<SDKCompactMessage, CompactResult> {
  yield { type: 'compact', phase: 'start' }

  try {
    const strippedMessages = stripImagesFromMessages(messages)
    const compactionPrompt = buildCompactionPrompt(strippedMessages)
    const requestParams = {
      model,
      maxTokens: 8192,
      system: COMPACT_SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: compactionPrompt }],
    }

    if (debug) {
      yield {
        type: 'compact' as const,
        phase: 'progress' as const,
        text: `\n[DEBUG] === COMPACT INPUT ===\n[DEBUG] System prompt:\n${COMPACT_SYSTEM_PROMPT}\n[DEBUG] Messages count: ${messages.length}\n[DEBUG] Compaction prompt length: ${compactionPrompt.length.toLocaleString()} chars\n[DEBUG] === COMPACT PROMPT START ===\n${compactionPrompt}\n[DEBUG] === COMPACT PROMPT END ===\n`,
      }
    }

    let summary = ''

    if (provider.createMessageStream) {
      for await (const chunk of provider.createMessageStream(requestParams)) {
        if (chunk.type === 'text' && chunk.delta) {
          summary += chunk.delta
          yield { type: 'compact', phase: 'progress', text: chunk.delta }
        }
      }
    } else {
      const response = await provider.createMessage(requestParams)
      summary = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n')
    }

    yield { type: 'compact', phase: 'end', summary }

    return {
      compactedMessages: buildCompactedMessages(summary),
      summary,
      state: {
        compacted: true,
        turnCounter: state.turnCounter,
        consecutiveFailures: 0,
        lastInputTokens: 0,
        lastOutputTokens: 0,
      },
    }
  } catch (err: any) {
    yield { type: 'compact', phase: 'end', summary: '' }
    return {
      compactedMessages: messages as NormalizedMessageParam[],
      summary: '',
      state: {
        ...state,
        consecutiveFailures: state.consecutiveFailures + 1,
      },
    }
  }
}

export async function compactConversation(
  provider: LLMProvider,
  model: string,
  messages: any[],
  state: AutoCompactState,
): Promise<CompactResult> {
  try {
    const strippedMessages = stripImagesFromMessages(messages)
    const compactionPrompt = buildCompactionPrompt(strippedMessages)

    const response = await provider.createMessage({
      model,
      maxTokens: 8192,
      system: COMPACT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: compactionPrompt }],
    })

    const summary = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')

    return {
      compactedMessages: buildCompactedMessages(summary),
      summary,
      state: {
        compacted: true,
        turnCounter: state.turnCounter,
        consecutiveFailures: 0,
        lastInputTokens: 0,
        lastOutputTokens: 0,
      },
    }
  } catch (err: any) {
    return {
      compactedMessages: messages,
      summary: '',
      state: {
        ...state,
        consecutiveFailures: state.consecutiveFailures + 1,
      },
    }
  }
}

/**
 * Compact a conversation while protecting the most recent turns.
 *
 * Splits the conversation into a "head" (summarized) and a "tail" (kept
 * verbatim). The last message and the most recent PRUNE_PROTECTED_TURNS user
 * turns are protected; everything before that is summarized via
 * compactConversationStream. Reassembles [summary, ...tail, lastMessage].
 *
 * Used by both auto-compaction and manual `compact()` triggers so that both
 * paths share identical behavior.
 */
export async function* compactConversationWithProtectedTail(
  provider: LLMProvider,
  model: string,
  messages: NormalizedMessageParam[],
  state: AutoCompactState,
): AsyncGenerator<SDKCompactMessage, {
  messages: NormalizedMessageParam[]
  state: AutoCompactState
  summary: string
}> {
  // Nothing meaningful to compact.
  if (messages.length < 2) {
    return { messages: [...messages], state, summary: '' }
  }

  const lastMsg = messages[messages.length - 1]
  const historyMsgs = messages.slice(0, -1)

  const userMsgIndices: number[] = []
  for (let i = 0; i < historyMsgs.length; i++) {
    if ((historyMsgs[i] as any).role === 'user') {
      userMsgIndices.push(i)
    }
  }
  const protectedStart = Math.max(0, userMsgIndices.length - PRUNE_PROTECTED_TURNS)
  const cutoffIndex = protectedStart < userMsgIndices.length
    ? userMsgIndices[protectedStart]
    : historyMsgs.length

  const headMsgs = historyMsgs.slice(0, cutoffIndex)
  const tailMsgs = historyMsgs.slice(cutoffIndex)

  const stream = compactConversationStream(
    provider,
    model,
    headMsgs as any[],
    state,
  )
  let result: CompactResult
  while (true) {
    const next = await stream.next()
    if (next.done) {
      result = next.value
      break
    }
    yield next.value
  }

  return {
    messages: [
      ...result.compactedMessages as NormalizedMessageParam[],
      ...tailMsgs as NormalizedMessageParam[],
      lastMsg,
    ],
    state: result.state,
    summary: result.summary,
  }
}

/**
 * Strip images from messages for compaction safety.
 */
function stripImagesFromMessages(
  messages: any[],
): any[] {
  return messages.map((msg: any) => {
    if (typeof msg.content === 'string') return msg

    const filtered = (msg.content as any[]).filter((block: any) => {
      return block.type !== 'image'
    })

    return { ...msg, content: filtered.length > 0 ? filtered : '[content removed for compaction]' }
  })
}

/**
 * Build compaction prompt from messages.
 */
function buildCompactionPrompt(messages: any[]): string {
  const parts: string[] = ['Please summarize this conversation:\n']

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'

    if (typeof msg.content === 'string') {
      parts.push(`${role}: ${msg.content.slice(0, 5000)}`)
    } else if (Array.isArray(msg.content)) {
      const texts: string[] = []
      for (const block of msg.content as any[]) {
        if (block.type === 'text') {
          texts.push(block.text.slice(0, 3000))
        } else if (block.type === 'tool_use') {
          texts.push(`[Tool: ${block.name}]`)
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string'
            ? block.content.slice(0, 1000)
            : '[tool result]'
          texts.push(`[Tool Result: ${content}]`)
        }
      }
      if (texts.length > 0) {
        parts.push(`${role}: ${texts.join('\n')}`)
      }
    }
  }

  return parts.join('\n\n')
}

/**
 * Micro-compact: optimize messages by truncating large tool results
 * to fit within token budgets.
 */
export function pruneMessages(messages: any[]): void {
  const userMsgIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      userMsgIndices.push(i)
    }
  }

  const protectedStart = Math.max(0, userMsgIndices.length - PRUNE_PROTECTED_TURNS)
  const protectedIndices = new Set(
    userMsgIndices.slice(protectedStart),
  )

  for (let i = 0; i < messages.length; i++) {
    if (protectedIndices.has(i)) continue

    const msg = messages[i]
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue

    for (const block of msg.content) {
      if (
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.length > PRUNE_THRESHOLD_CHARS
      ) {
        block.content = '[Old tool result content cleared]'
      }
    }
  }
}

export function microCompactMessages(
  messages: any[],
  maxToolResultChars: number = 50000,
): any[] {
  return messages.map((msg: any) => {
    if (typeof msg.content === 'string') return msg
    if (!Array.isArray(msg.content)) return msg

    const content = (msg.content as any[]).map((block: any) => {
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        if (block.content.length > maxToolResultChars) {
          return {
            ...block,
            content:
              block.content.slice(0, maxToolResultChars / 2) +
              '\n...(truncated)...\n' +
              block.content.slice(-maxToolResultChars / 2),
          }
        }
      }
      return block
    })

    return { ...msg, content }
  })
}
