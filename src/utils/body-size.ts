import { DEFAULT_MAX_REQUEST_BODY_BYTES } from './tokens.js'

export function estimateBodyBytes(messages: any[], systemPrompt?: string): number {
  let size = 0

  if (systemPrompt) {
    size += systemPrompt.length
  }

  for (const msg of messages) {
    size += 20
    if (typeof msg.content === 'string') {
      size += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        size += 30
        if (block.type === 'text') {
          size += (block.text || '').length
        } else if (block.type === 'image' && block.source?.type === 'base64') {
          size += (block.source.data || '').length
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            size += block.content.length
          } else if (Array.isArray(block.content)) {
            for (const sub of block.content) {
              if (sub.type === 'text') {
                size += (sub.text || '').length
              } else if (sub.type === 'image' && sub.source?.type === 'base64') {
                size += (sub.source.data || '').length
              }
            }
          }
        } else if (block.type === 'tool_use') {
          size += (block.name || '').length
          size += JSON.stringify(block.input || {}).length
        } else if (block.type === 'thinking') {
          size += (block.thinking || '').length
        }
      }
    }
  }

  return size
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface ImageLocation {
  msgIndex: number
  blockIndex: number
  byteSize: number
  mediaType: string
}

function collectImageLocations(messages: any[]): ImageLocation[] {
  const locations: ImageLocation[] = []

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi]
    if (typeof msg.content === 'string') continue
    if (!Array.isArray(msg.content)) continue

    for (let bi = 0; bi < msg.content.length; bi++) {
      const block = msg.content[bi]

      if (block.type === 'image' && block.source?.type === 'base64') {
        locations.push({
          msgIndex: mi,
          blockIndex: bi,
          byteSize: (block.source.data || '').length,
          mediaType: block.source.media_type || 'image/unknown',
        })
      }

      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        for (let si = 0; si < block.content.length; si++) {
          const sub = block.content[si]
          if (sub.type === 'image' && sub.source?.type === 'base64') {
            locations.push({
              msgIndex: mi,
              blockIndex: bi,
              byteSize: (sub.source.data || '').length,
              mediaType: sub.source.media_type || 'image/unknown',
              subIndex: si,
            } as ImageLocation & { subIndex: number })
          }
        }
      }
    }
  }

  return locations
}

export function enforceBodySizeLimit(
  messages: any[],
  maxBytes: number = DEFAULT_MAX_REQUEST_BODY_BYTES,
  systemPrompt?: string,
): { messages: any[]; strippedCount: number } {
  let currentSize = estimateBodyBytes(messages, systemPrompt)

  if (currentSize <= maxBytes) {
    return { messages, strippedCount: 0 }
  }

  const result = messages.map((msg) => {
    if (typeof msg.content === 'string') return msg
    if (!Array.isArray(msg.content)) return msg
    return { ...msg, content: [...msg.content] }
  })

  const locations = collectImageLocations(result)
  let strippedCount = 0

  for (const loc of locations) {
    if (currentSize <= maxBytes) break

    const msg = result[loc.msgIndex]
    const block = msg.content[loc.blockIndex]

    if ((loc as any).subIndex !== undefined) {
      const subIndex = (loc as any).subIndex
      const sub = block.content[subIndex]
      block.content = [...block.content]
      block.content[subIndex] = {
        type: 'text',
        text: `[Image: ${sub.source?.media_type || 'unknown'}, ${formatBytes(loc.byteSize)} — removed to fit request size limit]`,
      }
    } else {
      msg.content[loc.blockIndex] = {
        type: 'text',
        text: `[Image: ${loc.mediaType}, ${formatBytes(loc.byteSize)} — removed to fit request size limit]`,
      }
    }

    currentSize -= loc.byteSize
    strippedCount++
  }

  return { messages: result, strippedCount }
}
