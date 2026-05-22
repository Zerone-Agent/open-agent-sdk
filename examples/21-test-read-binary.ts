/**
 * Example 21: Test ReadTool Image/PDF/Binary Handling
 *
 * Tests that ReadTool correctly:
 * 1. Sniffs MIME by magic bytes (not just extension)
 * 2. Rejects binary Office files
 * 3. Returns image content blocks for images
 * 4. Returns content blocks for PDFs
 * 5. Detects binary by null-byte / non-printable ratio
 * 6. Reads text files normally
 * 7. [Optional] Sends image/PDF to LLM and verifies interpretation
 *
 * Run (local tests only):
 *   npx tsx examples/21-test-read-binary.ts
 *
 * Run (with LLM tests, requires OPENAGENT_API_KEY):
 *   OPENAGENT_API_KEY=sk-xxx npx tsx examples/21-test-read-binary.ts --llm
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { FileReadTool } from '../src/index.js'

const TMP_DIR = resolve(import.meta.dirname, '.tmp-read-test')
const withLLM = process.argv.includes('--llm')

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`)
}

async function callRead(file_path: string) {
  return FileReadTool.call({ file_path }, { cwd: TMP_DIR })
}

async function testLocal() {
  console.log('=== Local Tests ===\n')

  mkdirSync(TMP_DIR, { recursive: true })

  // Text file
  writeFileSync(resolve(TMP_DIR, 'test.txt'), 'hello world\nline 2\nline 3')

  // Real 1x1 red pixel PNG (correct magic bytes)
  writeFileSync(resolve(TMP_DIR, 'red-pixel.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  ))

  // PNG with .txt extension — MIME sniffing should still detect it as image
  writeFileSync(resolve(TMP_DIR, 'sneaky-image.txt'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  ))

  // Minimal valid PDF (starts with %PDF-)
  writeFileSync(resolve(TMP_DIR, 'hello.pdf'), [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >> endobj',
    '4 0 obj << /Length 44 >> stream',
    'BT /F1 24 Tf 100 700 Td (Hello PDF) Tj ET',
    'endstream endobj',
    'xref 0 5',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000266 00000 n ',
    'trailer << /Size 5 /Root 1 0 R >>',
    'startxref 365 %%EOF',
  ].join('\n'))

  // Binary Office files (should be rejected by extension)
  for (const name of ['test.docx', 'test.xlsx', 'test.pptx', 'test.xls', 'test.doc', 'test.ppt']) {
    writeFileSync(resolve(TMP_DIR, name), Buffer.from('PK\x03\x04fake'))
  }

  // File with null bytes (binary by content, unknown extension)
  writeFileSync(resolve(TMP_DIR, 'unknown.dat'), Buffer.from([0x01, 0x02, 0x00, 0x04, 0x05]))

  // File with high non-printable ratio (binary by content: bytes 0x01-0x1F range)
  const nonPrintable = Buffer.alloc(100)
  for (let i = 0; i < 50; i++) nonPrintable[i] = 0x01 + (i % 30) // 0x01-0x1F range
  for (let i = 50; i < 100; i++) nonPrintable[i] = 0x41
  writeFileSync(resolve(TMP_DIR, 'weird.xyz'), nonPrintable)

  // SVG — should be treated as text (excluded from image attachments)
  writeFileSync(resolve(TMP_DIR, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')

  // --- Tests ---

  // 1. Text file
  console.log('1. Text file (.txt):')
  const textResult = await callRead('test.txt')
  assert(!textResult.is_error, 'text should not error')
  assert(typeof textResult.content === 'string', 'text content should be string')
  assert((textResult.content as string).includes('hello world'), 'should contain text')
  console.log('   PASS\n')

  // 2. PNG image → content blocks
  console.log('2. PNG image (.png):')
  const imgResult = await callRead('red-pixel.png')
  assert(!imgResult.is_error, 'image should not error')
  assert(Array.isArray(imgResult.content), 'should return array content')
  const imgBlocks = imgResult.content as any[]
  assert(imgBlocks.some((b: any) => b.type === 'image'), 'should contain image block')
  const imgBlock = imgBlocks.find((b: any) => b.type === 'image')
  assert(imgBlock.source.media_type === 'image/png', 'media_type should be image/png')
  console.log(`   PASS: ${imgBlocks[0].text}`)
  console.log(`         [image: ${imgBlock.source.media_type}, base64 len=${imgBlock.source.data.length}]\n`)

  // 3. MIME sniffing: PNG with .txt extension
  console.log('3. MIME sniffing (PNG disguised as .txt):')
  const sneakyResult = await callRead('sneaky-image.txt')
  assert(!sneakyResult.is_error, 'should not error')
  assert(Array.isArray(sneakyResult.content), 'should detect as image by magic bytes')
  const sneakyBlocks = sneakyResult.content as any[]
  assert(sneakyBlocks.some((b: any) => b.type === 'image'), 'should contain image block')
  console.log(`   PASS: detected as image by magic bytes\n`)

  // 4. PDF → rejected as binary (same as docx/xlsx)
  console.log('4. PDF file (.pdf):')
  const pdfResult = await callRead('hello.pdf')
  assert(pdfResult.is_error, 'pdf should be error')
  assert((pdfResult.content as string).includes('Cannot read binary file'), 'should reject as binary')
  console.log(`   PASS: ${pdfResult.content}\n`)

  // 5. Binary rejection by extension
  for (const f of ['test.docx', 'test.xlsx', 'test.pptx', 'test.xls', 'test.doc', 'test.ppt']) {
    console.log(`5. Binary by extension (${f}):`)
    const r = await callRead(f)
    assert(r.is_error, `${f} should error`)
    assert((r.content as string).includes('Cannot read binary file'), 'should say Cannot read binary file')
    console.log(`   PASS\n`)
  }

  // 6. Binary by content (null byte)
  console.log('6. Binary by content (null bytes, .dat):')
  const nullResult = await callRead('unknown.dat')
  assert(nullResult.is_error, 'should detect binary by content')
  assert((nullResult.content as string).includes('Cannot read binary file'), 'should say Cannot read binary file')
  console.log(`   PASS: ${nullResult.content}\n`)

  // 7. Binary by content (high non-printable ratio)
  console.log('7. Binary by content (non-printable >30%, .xyz):')
  const weirdResult = await callRead('weird.xyz')
  assert(weirdResult.is_error, 'should detect binary by content')
  console.log(`   PASS: ${weirdResult.content}\n`)

  // 8. SVG → text (not image)
  console.log('8. SVG file (should be text, not image):')
  const svgResult = await callRead('icon.svg')
  assert(!svgResult.is_error, 'svg should not error')
  assert(typeof svgResult.content === 'string', 'svg should be read as text')
  assert((svgResult.content as string).includes('<svg'), 'should contain SVG markup')
  console.log('   PASS: SVG read as text\n')

  // 9. Non-existent file
  console.log('9. Non-existent file:')
  const noResult = await callRead('nonexistent.txt')
  assert(noResult.is_error, 'should error')
  assert((noResult.content as string).includes('File not found'), 'should say File not found')
  console.log(`   PASS\n`)

  console.log('--- All local tests passed! ---\n')
}

async function testOpenAIConversion() {
  console.log('=== OpenAI Provider Message Conversion ===\n')

  const { OpenAIProvider } = await import('../src/providers/openai.js')
  const provider = new OpenAIProvider({ apiKey: 'test-key' })

  // Access private convertMessages via any
  const convertMessages = (provider as any).convertMessages.bind(provider)

  // Simulate: user message containing a tool_result with image content blocks
  const messages = convertMessages(
    'You are helpful.',
    [
      // Assistant calls Read tool
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'red-pixel.png' } },
        ],
      },
      // User sends back tool result with image
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: [
              { type: 'text', text: '[Image file: red-pixel.png (70 bytes, image/png)]' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR...' } },
            ],
          },
        ],
      },
    ],
  )

  // 10. Check message structure
  console.log('10. OpenAI message conversion:')

  // Should have: system, assistant (tool_call), tool (text only), user (image attachment)
  assert(messages.length === 4, `expected 4 messages, got ${messages.length}`)

  const [sys, assistant, tool, userImage] = messages

  assert(sys.role === 'system', 'first should be system')
  assert(assistant.role === 'assistant' && assistant.tool_calls?.length === 1, 'second should be assistant with tool_call')
  assert(tool.role === 'tool' && typeof tool.content === 'string', 'third should be tool with text content')
  assert(!tool.content.includes('iVBOR'), 'tool message should NOT contain image data')

  console.log(`   system: ${sys.role}`)
  console.log(`   assistant: ${assistant.role}, tool_calls=${assistant.tool_calls?.length}`)
  console.log(`   tool: role=${tool.role}, content="${(tool.content as string).slice(0, 80)}"`)

  // Synthetic user message with image
  assert(userImage.role === 'user', 'fourth should be user')
  assert(Array.isArray(userImage.content), 'user message should have array content')
  const userContent = userImage.content as any[]
  assert(userContent.length === 2, `expected 2 parts in user message, got ${userContent.length}`)
  assert(userContent[0].type === 'text' && userContent[0].text.includes('Attached'), 'first part should be text intro')
  assert(userContent[1].type === 'image_url', 'second part should be image_url')
  assert(userContent[1].image_url?.url?.startsWith('data:image/png;base64,'), 'image_url should have data URI')

  console.log(`   user (synthetic): role=${userImage.role}, parts=[${userContent.map((p: any) => p.type).join(', ')}]`)
  console.log(`     → "${userContent[0].text}"`)
  console.log(`     → image_url: ${userContent[1].image_url.url.slice(0, 40)}...`)
  console.log('   PASS\n')

  // 11. Tool result with plain text (no media) should work as before
  console.log('11. OpenAI plain text tool result:')
  const plainMessages = convertMessages(
    '',
    [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: 'test.txt' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: '1\thello world' }] },
    ],
  )
  // Should have: assistant (tool_call), tool (text)
  assert(plainMessages.length === 2, `expected 2 messages, got ${plainMessages.length}`)
  assert(plainMessages[0].role === 'assistant', 'first should be assistant')
  assert(plainMessages[1].role === 'tool', 'second should be tool')
  assert(plainMessages[1].content === '1\thello world', 'tool content should be text')
  console.log('   PASS: plain text tool result preserved\n')

  console.log('--- OpenAI conversion tests passed! ---\n')
}

async function testLLM() {
  console.log('=== LLM Tests ===\n')

  const { createAgent } = await import('../src/index.js')
  const apiKey = process.env.OPENAGENT_API_KEY
  if (!apiKey) {
    console.log('SKIP: OPENAGENT_API_KEY not set\n')
    return
  }

  const tests = [
    { prompt: 'Read the file red-pixel.png using the Read tool and describe what you see. Be brief.', label: 'PNG → LLM' },
    { prompt: 'Try to read the file test.docx using the Read tool. What error do you get?', label: 'Binary rejection → LLM' },
  ]

  for (const { prompt, label } of tests) {
    console.log(`${label}:`)
    const agent = createAgent({
      model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
      apiKey,
      maxTurns: 3,
      cwd: TMP_DIR,
    })
    for await (const event of agent.query(prompt)) {
      if (event.type === 'assistant') {
        for (const block of (event as any).message?.content || []) {
          if (block.type === 'tool_use') {
            console.log(`  [tool_use] ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`)
          }
          if (block.type === 'text' && block.text.trim()) {
            console.log(`  [LLM] ${block.text}`)
          }
        }
      }
      if (event.type === 'tool_result') {
        const output = (event as any).result?.output || ''
        console.log(`  [tool_result] ${output.slice(0, 200)}`)
      }
      if (event.type === 'result') {
        const r = event as any
        console.log(`  → ${r.subtype} ${r.errors?.join(', ') || ''}`)
      }
    }
    console.log()
  }

  console.log('--- LLM tests done ---\n')
}

async function main() {
  console.log('--- Test ReadTool Media Handling (opencode-style) ---\n')

  try {
    await testLocal()
    await testOpenAIConversion()
    if (withLLM) {
      await testLLM()
    } else {
      console.log('Tip: Add --llm flag and set OPENAGENT_API_KEY to test LLM interpretation.')
    }
  } finally {
    rmSync(TMP_DIR, { recursive: true, force: true })
  }
}

main().catch((err) => {
  rmSync(TMP_DIR, { recursive: true, force: true })
  console.error(err)
  process.exit(1)
})
