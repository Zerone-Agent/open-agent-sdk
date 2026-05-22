/**
 * FileReadTool - Read file contents with line numbers
 *
 * Handles three paths:
 * 1. Image/PDF → base64 attachment (data URI)
 * 2. Binary → rejection error
 * 3. Text → line-numbered content
 */

import { readFile, stat } from 'fs/promises'
import { resolve, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineTool } from './types.js'

const SAMPLE_BYTES = 4096
const NON_PRINTABLE_THRESHOLD = 0.3

const BINARY_EXTENSIONS = new Set([
  'doc', 'docx',
  'xls', 'xlsx',
  'ppt', 'pptx',
  'odt', 'ods', 'odp',
  'rtf',
  'exe', 'dll', 'so', 'dylib', 'wasm',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'jar', 'war', 'class',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'avi', 'mov', 'mkv', 'flac', 'wav', 'wmv',
  'sqlite', 'db',
  'bin', 'dat', 'obj', 'o', 'a', 'lib',
  'pyc', 'pyo',
])

function startsWith(bytes: Buffer, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((v, i) => bytes[i] === v)
}

function sniffMime(bytes: Buffer, fallback: string): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp'
  }
  return fallback
}

const EXT_MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
}

function isImageAttachment(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml'
}

function getExtension(filePath: string): string {
  return extname(filePath).slice(1).toLowerCase()
}

function isBinaryByExtension(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(filePath))
}

function isBinaryByContent(bytes: Buffer): boolean {
  if (bytes.length === 0) return false
  let nonPrintable = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintable++
    }
  }
  return nonPrintable / bytes.length > NON_PRINTABLE_THRESHOLD
}

interface ExtractPdfResult {
  text: string
  pageCount: number
  fieldCount: number
}

async function extractPdfText(filePath: string): Promise<ExtractPdfResult> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

    let standardFontDataUrl: string | undefined
    try {
      const pdfjsPkgPath = require.resolve('pdfjs-dist/package.json')
      standardFontDataUrl = dirname(pdfjsPkgPath) + '/standard_fonts/'
    } catch {}

    const data = new Uint8Array(await readFile(filePath))
    const doc = await pdfjs.getDocument({ data, standardFontDataUrl }).promise
    const pageCount = doc.numPages

    let fullText = `--- PDF: ${filePath} (${pageCount} page${pageCount !== 1 ? 's' : ''}) ---\n\n`

    // 提取每页文本
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item: any) => item.str)
        .join('')
        .trim()

      fullText += `=== Page ${i} ===\n${pageText}\n\n`
      page.cleanup()
    }

    // 提取表单字段 (AcroForm)
    let fieldCount = 0
    try {
      const fieldObjects = await doc.getFieldObjects()
      if (fieldObjects && Object.keys(fieldObjects).length > 0) {
        const formFields: Record<string, string> = {}
        for (const [name, field] of Object.entries(fieldObjects)) {
          if (Array.isArray(field)) {
            const values = field
              .map((f: any) => f.value)
              .filter((v: any) => v !== undefined && v !== null && v !== '')
            if (values.length > 0) {
              formFields[name] = values.join(', ')
            }
          } else {
            const value = (field as any)?.value
            if (value !== undefined && value !== null && value !== '') {
              formFields[name] = String(value)
            }
          }
        }

        if (Object.keys(formFields).length > 0) {
          fieldCount = Object.keys(formFields).length
          fullText += `=== Form Fields (${fieldCount}) ===\n`
          for (const [name, value] of Object.entries(formFields)) {
            fullText += `${name}: ${value}\n`
          }
          fullText += '\n'
        }
      }
    } catch {
      // 忽略表单提取错误 (不是所有 PDF 都有表单)
    }

    await doc.destroy()

    return { text: fullText.trimEnd(), pageCount, fieldCount }
  } catch (err: any) {
    if (err.message?.includes('password')) {
      throw new Error('Encrypted PDF not supported')
    }
    throw new Error(`Failed to parse PDF: ${err.message}`)
  }
}

export const FileReadTool = defineTool({
  name: 'Read',
  description: 'Read a file from the filesystem. Returns content with line numbers. Supports text files, images (returns visual content), and PDFs.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (0-based)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read',
      },
    },
    required: ['file_path'],
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  async call(input, context) {
    const filePath = resolve(context.cwd, input.file_path)

    try {
      const fileStat = await stat(filePath)
      if (fileStat.isDirectory()) {
        return { data: `Error: ${filePath} is a directory, not a file. Use Bash with 'ls' to list directory contents.`, is_error: true }
      }

      const ext = getExtension(filePath)
      const fallbackMime = EXT_MIME_MAP[ext] || ''

      let sample: Buffer
      try {
        const handle = await import('fs/promises').then(m => m.open(filePath, 'r'))
        sample = Buffer.alloc(Math.min(SAMPLE_BYTES, fileStat.size))
        await handle.read(sample, 0, sample.length, 0)
        await handle.close()
      } catch {
        sample = Buffer.alloc(0)
      }

      const mime = sniffMime(sample, fallbackMime)

      if (isImageAttachment(mime)) {
        const buffer = await readFile(filePath)
        const base64 = buffer.toString('base64')
        return {
          data: [
            { type: 'text' as const, text: `[Image file: ${filePath} (${fileStat.size} bytes, ${mime})]` },
            { type: 'image' as const, source: { type: 'base64' as const, media_type: mime as any, data: base64 } },
          ],
        }
      }

      if (mime === 'application/pdf') {
        try {
          const { text } = await extractPdfText(filePath)
          const lines = text.split('\n')
          const offset = input.offset || 0
          const limit = input.limit || 2000
          const selectedLines = lines.slice(offset, offset + limit)

          const numbered = selectedLines.map((line: string, i: number) => {
            const lineNum = offset + i + 1
            return `${lineNum}\t${line}`
          }).join('\n')

          let result = numbered
          if (lines.length > offset + limit) {
            result += `\n\n(${lines.length - offset - limit} more lines not shown)`
          }

          return result || '(empty PDF)'
        } catch (err: any) {
          if (err.message?.includes('Cannot find module') || err.message?.includes('pdfjs-dist')) {
            return {
              data: `Error: PDF support requires pdfjs-dist. Install it with: npm install pdfjs-dist`,
              is_error: true,
            }
          }
          return {
            data: `Error: ${err.message}`,
            is_error: true,
          }
        }
      }

      if (isBinaryByExtension(filePath) || isBinaryByContent(sample)) {
        return { data: `Cannot read binary file: ${filePath}`, is_error: true }
      }

      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n')

      const offset = input.offset || 0
      const limit = input.limit || 2000
      const selectedLines = lines.slice(offset, offset + limit)

      const numbered = selectedLines.map((line: string, i: number) => {
        const lineNum = offset + i + 1
        return `${lineNum}\t${line}`
      }).join('\n')

      let result = numbered
      if (lines.length > offset + limit) {
        result += `\n\n(${lines.length - offset - limit} more lines not shown)`
      }

      return result || '(empty file)'
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { data: `Error: File not found: ${filePath}`, is_error: true }
      }
      return { data: `Error reading file: ${err.message}`, is_error: true }
    }
  },
})
