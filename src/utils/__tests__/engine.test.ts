import { describe, expect, it } from 'vitest'

describe('tool input required-field validation', () => {
  function validateRequiredFields(
    input: Record<string, unknown>,
    required: string[],
  ): string[] {
    return required.filter((key) => input[key] === undefined || input[key] === null)
  }

  it('returns empty array when all required fields present', () => {
    const missing = validateRequiredFields(
      { filePath: '/a.txt', content: 'hi' },
      ['filePath', 'content'],
    )
    expect(missing).toEqual([])
  })

  it('detects missing required fields', () => {
    const missing = validateRequiredFields(
      { filePath: '/a.txt' },
      ['filePath', 'content'],
    )
    expect(missing).toEqual(['content'])
  })

  it('detects null values as missing', () => {
    const missing = validateRequiredFields(
      { filePath: '/a.txt', content: null },
      ['filePath', 'content'],
    )
    expect(missing).toEqual(['content'])
  })

  it('passes when no required fields defined', () => {
    const missing = validateRequiredFields({}, [])
    expect(missing).toEqual([])
  })

  it('detects multiple missing fields', () => {
    const missing = validateRequiredFields(
      {},
      ['filePath', 'content', 'mode'],
    )
    expect(missing).toEqual(['filePath', 'content', 'mode'])
  })

  it('detects undefined values as missing', () => {
    const missing = validateRequiredFields(
      { filePath: '/a.txt', content: undefined },
      ['filePath', 'content'],
    )
    expect(missing).toEqual(['content'])
  })
})

describe('buildResponseFromChunks: tool_use accumulation', () => {
  interface StreamChunk {
    type: string
    index: number
    id?: string
    name?: string
    input?: string
  }

  function simulateBuildResponse(chunks: StreamChunk[]) {
    const toolUses: Map<number, { id: string; name: string; input: string }> = new Map()

    for (const chunk of chunks) {
      if (chunk.type === 'tool_use') {
        const toolUse = toolUses.get(chunk.index) || { id: '', name: '', input: '' }
        if (chunk.id) toolUse.id = chunk.id
        if (chunk.name) toolUse.name = chunk.name
        if (chunk.input !== undefined && chunk.input !== '') {
          toolUse.input += chunk.input
        }
        toolUses.set(chunk.index, toolUse)
      }
    }

    const results: Array<{ id: string; name: string; input: any }> = []
    for (const [, toolUse] of toolUses) {
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
        results.push({ id: toolUse.id, name: toolUse.name, input })
      }
    }
    return results
  }

  it('assembles complete tool_use from single chunk', () => {
    const chunks: StreamChunk[] = [
      { type: 'tool_use', index: 0, id: 'call_1', name: 'Write', input: '{"filePath":"/a.txt","content":"hi"}' },
    ]
    const results = simulateBuildResponse(chunks)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Write')
    expect(results[0].input).toEqual({ filePath: '/a.txt', content: 'hi' })
  })

  it('appends incremental input chunks', () => {
    const chunks: StreamChunk[] = [
      { type: 'tool_use', index: 0, id: 'call_1', name: 'Write', input: '{"filePa' },
      { type: 'tool_use', index: 0, input: 'th":"/a.txt",' },
      { type: 'tool_use', index: 0, input: '"content":"hello"}' },
    ]
    const results = simulateBuildResponse(chunks)
    expect(results).toHaveLength(1)
    expect(results[0].input).toEqual({ filePath: '/a.txt', content: 'hello' })
  })

  it('handles tool_use with empty input (no arguments)', () => {
    const chunks: StreamChunk[] = [
      { type: 'tool_use', index: 0, id: 'call_1', name: 'ListFiles', input: '' },
    ]
    const results = simulateBuildResponse(chunks)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('ListFiles')
    expect(results[0].input).toEqual({})
  })

  it('falls back to raw string on truncated JSON', () => {
    const chunks: StreamChunk[] = [
      { type: 'tool_use', index: 0, id: 'call_1', name: 'Write', input: '{"filePath":"/a.txt","content":"hel' },
    ]
    const results = simulateBuildResponse(chunks)
    expect(results).toHaveLength(1)
    expect(typeof results[0].input).toBe('string')
  })

  it('handles multiple parallel tool calls', () => {
    const chunks: StreamChunk[] = [
      { type: 'tool_use', index: 0, id: 'call_1', name: 'Read', input: '{"path":"/a.txt"}' },
      { type: 'tool_use', index: 1, id: 'call_2', name: 'Read', input: '{"path":"/b.txt"}' },
    ]
    const results = simulateBuildResponse(chunks)
    expect(results).toHaveLength(2)
    expect(results[0].input).toEqual({ path: '/a.txt' })
    expect(results[1].input).toEqual({ path: '/b.txt' })
  })

  it('does not drop tool_use when name exists but input is empty', () => {
    const chunks: StreamChunk[] = [
      { type: 'tool_use', index: 0, id: 'call_1', name: 'Ping' },
    ]
    const results = simulateBuildResponse(chunks)
    expect(results).toHaveLength(1)
    expect(results[0].input).toEqual({})
  })
})

describe('max_tokens truncation detection', () => {
  interface ContentBlock {
    type: string
    name?: string
    input?: any
    text?: string
  }

  function shouldYieldTruncationWarning(
    stopReason: string,
    content: ContentBlock[],
  ): boolean {
    return stopReason === 'max_tokens' && content.some((b) => b.type === 'tool_use')
  }

  function shouldContinueText(
    stopReason: string,
    content: ContentBlock[],
    maxAttempts: number,
    currentAttempts: number,
  ): boolean {
    return (
      stopReason === 'max_tokens' &&
      !content.some((b) => b.type === 'tool_use') &&
      currentAttempts < maxAttempts
    )
  }

  it('yields warning when max_tokens and tool_use present', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'I will write the file...' },
      { type: 'tool_use', name: 'Write', input: '{"filePath":"/big.txt","content":"...truncated' },
    ]
    expect(shouldYieldTruncationWarning('max_tokens', content)).toBe(true)
  })

  it('does not yield warning when stopReason is end_turn', () => {
    const content: ContentBlock[] = [
      { type: 'tool_use', name: 'Write', input: { filePath: '/a.txt', content: 'ok' } },
    ]
    expect(shouldYieldTruncationWarning('end_turn', content)).toBe(false)
  })

  it('does not yield warning when no tool_use in content', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'Partial response...' },
    ]
    expect(shouldYieldTruncationWarning('max_tokens', content)).toBe(false)
  })

  it('continues text recovery when max_tokens with text-only content', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'Let me explain...' },
    ]
    expect(shouldContinueText('max_tokens', content, 3, 0)).toBe(true)
  })

  it('does not continue recovery when tool_use present', () => {
    const content: ContentBlock[] = [
      { type: 'tool_use', name: 'Write', input: {} },
    ]
    expect(shouldContinueText('max_tokens', content, 3, 0)).toBe(false)
  })

  it('stops recovery after max attempts', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'Still going...' },
    ]
    expect(shouldContinueText('max_tokens', content, 3, 3)).toBe(false)
  })

  it('handles multiple tool_use blocks all truncated', () => {
    const content: ContentBlock[] = [
      { type: 'tool_use', name: 'Read', input: '{"path":"/a' },
      { type: 'tool_use', name: 'Write', input: '{"filePath":"/b' },
    ]
    expect(shouldYieldTruncationWarning('max_tokens', content)).toBe(true)
  })
})

describe('truncated tool call detection by input type', () => {
  interface ToolUseBlock {
    type: 'tool_use'
    id: string
    name: string
    input: any
  }

  function detectTruncated(blocks: ToolUseBlock[]): ToolUseBlock[] {
    return blocks.filter((b) => typeof b.input === 'string')
  }

  function detectValid(blocks: ToolUseBlock[]): ToolUseBlock[] {
    return blocks.filter((b) => typeof b.input !== 'string')
  }

  it('detects tool call with raw string input as truncated', () => {
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'c1', name: 'Write', input: '{"filePath":"/a.txt","content":"hel' },
    ]
    expect(detectTruncated(blocks)).toHaveLength(1)
    expect(detectValid(blocks)).toHaveLength(0)
  })

  it('detects valid tool call with parsed object input', () => {
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'c1', name: 'Write', input: { filePath: '/a.txt', content: 'ok' } },
    ]
    expect(detectTruncated(blocks)).toHaveLength(0)
    expect(detectValid(blocks)).toHaveLength(1)
  })

  it('handles mix of truncated and valid tool calls', () => {
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'c1', name: 'Read', input: { path: '/a.txt' } },
      { type: 'tool_use', id: 'c2', name: 'Write', input: '{"filePath":"/b.txt","content":"unfi' },
    ]
    expect(detectTruncated(blocks)).toHaveLength(1)
    expect(detectValid(blocks)).toHaveLength(1)
    expect(detectTruncated(blocks)[0].name).toBe('Write')
    expect(detectValid(blocks)[0].name).toBe('Read')
  })

  it('detects tool call with empty object as valid (no arguments)', () => {
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'c1', name: 'Ping', input: {} },
    ]
    expect(detectTruncated(blocks)).toHaveLength(0)
    expect(detectValid(blocks)).toHaveLength(1)
  })

  it('does not execute truncated tool calls even with tool_use stopReason', () => {
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'c1', name: 'Write', input: '{"filePath":"/big.txt","content":"' },
    ]
    // stopReason is 'tool_use' but input is still a raw string
    const truncated = detectTruncated(blocks)
    expect(truncated).toHaveLength(1)
    // Should NOT pass this block to executeTools
    expect(detectValid(blocks)).toHaveLength(0)
  })
})
