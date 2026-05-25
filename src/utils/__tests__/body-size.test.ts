import { describe, expect, it } from 'vitest'
import { enforceBodySizeLimit, estimateBodyBytes } from '../body-size.js'
import { normalizeMessagesForAPI } from '../messages.js'
import { microCompactMessages } from '../compact.js'

const SMALL_MAX = 1000

function makeBase64(len: number): string {
  return 'A'.repeat(len)
}

function makeUserPastedImage(base64Len: number) {
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/png', data: makeBase64(base64Len) },
  }
}

function makeToolResultImage(toolUseId: string, base64Len: number) {
  return {
    type: 'tool_result' as const,
    tool_use_id: toolUseId,
    content: [
      { type: 'text' as const, text: '[Image file: test.png]' },
      {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/png', data: makeBase64(base64Len) },
      },
    ],
  }
}

describe('estimateBodyBytes', () => {
  it('counts top-level user-pasted image base64 data', () => {
    const base64Len = 5000
    const messages = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(base64Len),
          { type: 'text', text: 'look at this' },
        ],
      },
    ]
    const size = estimateBodyBytes(messages)
    expect(size).toBeGreaterThanOrEqual(base64Len)
  })

  it('counts tool_result image base64 data', () => {
    const base64Len = 5000
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.png' } }] },
      { role: 'user', content: [makeToolResultImage('tu_1', base64Len)] },
    ]
    const size = estimateBodyBytes(messages)
    expect(size).toBeGreaterThanOrEqual(base64Len)
  })
})

describe('enforceBodySizeLimit', () => {
  it('strips user-pasted images when body exceeds limit', () => {
    const base64Len = 2000
    const messages = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(base64Len),
          { type: 'text', text: 'look at this image' },
        ],
      },
    ]

    const result = enforceBodySizeLimit(messages, SMALL_MAX)
    expect(result.strippedCount).toBe(1)

    const userContent = result.messages[0].content
    const imageBlocks = userContent.filter((b: any) => b.type === 'image')
    expect(imageBlocks.length).toBe(0)

    const textBlocks = userContent.filter((b: any) => b.type === 'text')
    expect(textBlocks.length).toBe(2)
    expect(textBlocks[1].text).toBe('look at this image')
    expect(textBlocks[0].text).toContain('removed to fit request size limit')
  })

  it('strips tool_result images when body exceeds limit', () => {
    const base64Len = 2000
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
      { role: 'user', content: [makeToolResultImage('tu_1', base64Len)] },
    ]

    const result = enforceBodySizeLimit(messages, SMALL_MAX)
    expect(result.strippedCount).toBe(1)

    const toolResult = result.messages[1].content[0]
    const imageBlocks = toolResult.content.filter((b: any) => b.type === 'image')
    expect(imageBlocks.length).toBe(0)

    const textBlocks = toolResult.content.filter((b: any) => b.type === 'text')
    expect(textBlocks.some((b: any) => b.text.includes('removed to fit request size limit'))).toBe(true)
  })

  it('strips both user-pasted and tool_result images when both exceed limit', () => {
    const base64Len = 2000
    const messages = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(base64Len),
          { type: 'text', text: 'look at this' },
        ],
      },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
      { role: 'user', content: [makeToolResultImage('tu_1', base64Len)] },
    ]

    const result = enforceBodySizeLimit(messages, SMALL_MAX)
    expect(result.strippedCount).toBe(2)

    const userContent0 = result.messages[0].content
    expect(userContent0.filter((b: any) => b.type === 'image').length).toBe(0)

    const toolResult = result.messages[2].content[0]
    expect(toolResult.content.filter((b: any) => b.type === 'image').length).toBe(0)
  })

  it('strips oldest images first (user-pasted before tool_result)', () => {
    const base64Len = 600
    const messages = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(base64Len),
          { type: 'text', text: 'user image' },
        ],
      },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
      { role: 'user', content: [makeToolResultImage('tu_1', base64Len)] },
    ]

    const totalSize = estimateBodyBytes(messages)
    const maxBytes = Math.ceil(totalSize * 0.75)
    const result = enforceBodySizeLimit(messages, maxBytes)
    expect(result.strippedCount).toBe(1)

    const userContent0 = result.messages[0].content
    const hasUserImage = userContent0.some((b: any) => b.type === 'image')
    expect(hasUserImage).toBe(false)

    const toolResult = result.messages[2].content[0]
    const hasToolImage = toolResult.content.some((b: any) => b.type === 'image')
    expect(hasToolImage).toBe(true)
  })

  it('does not strip when under limit', () => {
    const base64Len = 10
    const messages = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(base64Len),
          { type: 'text', text: 'small image' },
        ],
      },
    ]

    const result = enforceBodySizeLimit(messages, 10000)
    expect(result.strippedCount).toBe(0)

    const userContent = result.messages[0].content
    expect(userContent.some((b: any) => b.type === 'image')).toBe(true)
  })
})

describe('engine pipeline: normalizeMessagesForAPI -> microCompact -> enforceBodySizeLimit', () => {
  const SMALL_MAX = 1000

  it('strips user-pasted image through full pipeline', () => {
    const messages = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(2000),
          { type: 'text', text: 'look at this' },
        ],
      },
    ]

    const normalized = normalizeMessagesForAPI(messages)
    const compacted = microCompactMessages(normalized)
    const result = enforceBodySizeLimit(compacted, SMALL_MAX)

    expect(result.strippedCount).toBe(1)
    expect(
      result.messages[0].content.some((b: any) => b.type === 'image')
    ).toBe(false)
  })

  it('strips tool_result image through full pipeline', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'read the image' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.png' } },
        ],
      },
      {
        role: 'user',
        content: [makeToolResultImage('tu_1', 2000)],
      },
    ]

    const normalized = normalizeMessagesForAPI(messages)
    const compacted = microCompactMessages(normalized)
    const result = enforceBodySizeLimit(compacted, SMALL_MAX)

    expect(result.strippedCount).toBe(1)
    const toolResult = result.messages[2].content[0]
    expect(toolResult.content.filter((b: any) => b.type === 'image').length).toBe(0)
  })

  it('strips both user-pasted and tool_result images through full pipeline', () => {
    const messages = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(2000),
          { type: 'text', text: 'look at this' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.png' } },
        ],
      },
      {
        role: 'user',
        content: [makeToolResultImage('tu_1', 2000)],
      },
    ]

    const normalized = normalizeMessagesForAPI(messages)
    const compacted = microCompactMessages(normalized)
    const result = enforceBodySizeLimit(compacted, SMALL_MAX)

    expect(result.strippedCount).toBe(2)
    expect(
      result.messages[0].content.some((b: any) => b.type === 'image')
    ).toBe(false)
    const toolResult = result.messages[2].content[0]
    expect(toolResult.content.filter((b: any) => b.type === 'image').length).toBe(0)
  })

  it('user-pasted image survives normalizeMessagesForAPI', () => {
    const base64Data = makeBase64(100)
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Data } },
          { type: 'text', text: 'hello' },
        ],
      },
    ]

    const normalized = normalizeMessagesForAPI(messages)
    expect(normalized[0].content).toHaveLength(2)
    const imgBlock = normalized[0].content.find((b: any) => b.type === 'image')
    expect(imgBlock).toBeDefined()
    expect(imgBlock.source.data).toBe(base64Data)
  })
})

describe('engine-level sync: strip result updates source messages', () => {
  it('syncing apiMessages back to source removes user-pasted images from transcript', () => {
    const base64Len = 2000
    let messages: any[] = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(base64Len),
          { type: 'text', text: 'look at this' },
        ],
      },
    ]

    const apiMessages = microCompactMessages(
      normalizeMessagesForAPI(messages),
    )
    const result = enforceBodySizeLimit(apiMessages, SMALL_MAX)
    const strippedApiMessages = result.messages
    expect(result.strippedCount).toBe(1)

    if (result.strippedCount > 0) {
      messages = strippedApiMessages
    }

    expect(messages[0].content.some((b: any) => b.type === 'image')).toBe(false)
    expect(messages[0].content.some((b: any) => b.type === 'text' && b.text.includes('removed to fit'))).toBe(true)
  })

  it('syncing apiMessages back updates both user-pasted and tool_result images', () => {
    const base64Len = 2000
    let messages: any[] = [
      {
        role: 'user',
        content: [
          makeUserPastedImage(base64Len),
          { type: 'text', text: 'look at this' },
        ],
      },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
      { role: 'user', content: [makeToolResultImage('tu_1', base64Len)] },
    ]

    const apiMessages = microCompactMessages(
      normalizeMessagesForAPI(messages),
    )
    const result = enforceBodySizeLimit(apiMessages, SMALL_MAX)
    expect(result.strippedCount).toBe(2)

    if (result.strippedCount > 0) {
      messages = result.messages
    }

    expect(messages[0].content.some((b: any) => b.type === 'image')).toBe(false)
    const toolResult = messages[2].content[0]
    expect(toolResult.content.filter((b: any) => b.type === 'image').length).toBe(0)
  })
})
