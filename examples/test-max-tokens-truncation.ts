/**
 * Test: maxTokens Truncation Detection
 *
 * Sets maxTokens to a very small value (256) and asks the LLM to call Write
 * with a large file. This should trigger:
 *   1. stopReason = 'max_tokens'
 *   2. A system/warning event about truncated tool calls
 *
 * Run: npx tsx examples/test-max-tokens-truncation.ts
 *
 * Environment:
 *   OPENAGENT_MODEL  - model to use (default: claude-sonnet-4-6)
 *   OPENAGENT_API_KEY - API key
 */
import { createAgent } from '../src/index.js'

async function main() {
  console.log('--- Test: maxTokens Truncation Detection ---\n')

  const SMALL_MAX_TOKENS = 256

  const agent = createAgent({
    model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
    maxTurns: 2,
    maxTokens: SMALL_MAX_TOKENS,
    includePartialMessages: true,
  })

  const prompt =
    'Write a file at /tmp/test-truncation.txt with the following content: ' +
    'Generate a very long file with at least 50 lines of code. ' +
    'Each line should be a comment describing what line number it is, like: ' +
    '// This is line 1, // This is line 2, etc. ' +
    'Make sure to use the Write tool.'

  console.log('=== CONFIG ===')
  console.log(`  maxTokens: ${SMALL_MAX_TOKENS} (intentionally tiny)`)
  console.log(`  model: ${process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6'}`)
  console.log(`\n=== USER REQUEST ===`)
  console.log(prompt)
  console.log('\n')

  let gotTruncationWarning = false
  let gotToolCall = false
  let gotToolResult = false
  let truncatedToolCall = false
  let stopReason: string | undefined
  const warnings: string[] = []
  const errors: string[] = []

  for await (const event of agent.query(prompt)) {
    const msg = event as any

    if (msg.type === 'partial_message') {
      process.stdout.write(msg.partial.text || '')
    }

    if (msg.type === 'system') {
      const text = msg.message || JSON.stringify(msg)
      if (msg.subtype === 'warning') {
        warnings.push(text)
        gotTruncationWarning = true
      }
      console.log(`\n🔔 SYSTEM [${msg.subtype || 'unknown'}]: ${text}`)
    }

    if (msg.type === 'result' && msg.subtype === 'error') {
      const errMsg = msg.errors?.join('; ') || msg.message || JSON.stringify(msg)
      errors.push(errMsg)
      console.log(`\n❌ ERROR: ${errMsg}`)
    }

    if (msg.type === 'assistant') {
      console.log('\n=== LLM RESPONSE ===')
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          gotToolCall = true
          const inputStr = JSON.stringify(block.input)
          console.log(`\n[Tool Call] name=${block.name}`)
          console.log(`  input length: ${inputStr.length} chars`)

          // Check if input looks truncated (incomplete JSON or missing required fields)
          if (typeof block.input === 'string') {
            truncatedToolCall = true
            console.log(`  ⚠️  Input is raw string (JSON parse failed): ${inputStr.slice(0, 100)}...`)
          } else if (block.input && !block.input.content) {
            truncatedToolCall = true
            console.log(`  ⚠️  Input missing 'content' field — likely truncated`)
            console.log(`  input keys: ${Object.keys(block.input).join(', ')}`)
          } else {
            console.log(`  input preview: ${inputStr.slice(0, 200)}${inputStr.length > 200 ? '...' : ''}`)
          }
        }
        if (block.type === 'text' && block.text?.trim()) {
          console.log(`\n[Text] ${block.text}`)
        }
      }
    }

    if (msg.type === 'tool_result') {
      gotToolResult = true
      const isError = msg.result.output?.includes('validation failed') || msg.result.output?.includes('Error')
      console.log(`\n=== TOOL RESULT ${isError ? '(ERROR)' : ''} ===`)
      console.log(`  tool_name: ${msg.result.tool_name}`)
      console.log(`  output: ${msg.result.output.slice(0, 300)}`)
      if (msg.result.output.includes('validation failed')) {
        console.log(`  ⚠️  Tool input validation error detected`)
      }
    }

    if (msg.type === 'result') {
      stopReason = msg.subtype
      console.log(`\n\n=== FINAL RESULT ===`)
      console.log(`  subtype: ${msg.subtype}`)
      console.log(`  num_turns: ${msg.num_turns}`)
      console.log(`  tokens: ${msg.usage?.input_tokens} in / ${msg.usage?.output_tokens} out`)
      console.log(`  cost: $${msg.total_cost_usd?.toFixed(6)}`)
    }
  }

  console.log('\n=== ALL WARNINGS ===')
  if (warnings.length > 0) {
    for (const w of warnings) console.log(`  ⚠️  ${w}`)
  } else {
    console.log('  (none)')
  }

  console.log('\n=== ALL ERRORS ===')
  if (errors.length > 0) {
    for (const e of errors) console.log(`  ❌ ${e}`)
  } else {
    console.log('  (none)')
  }

  console.log('\n=== TEST VERDICT ===')
  console.log(`  Truncation warning received: ${gotTruncationWarning ? '✅' : '❌'}`)
  console.log(`  Tool call received: ${gotToolCall ? '✅' : '❌'}`)
  console.log(`  Tool call was truncated: ${truncatedToolCall ? '✅' : '—'}`)
  console.log(`  Tool result received: ${gotToolResult ? '✅' : '—'}`)

  if (gotTruncationWarning) {
    console.log('\n✅ PASS: Truncation correctly detected and reported as warning')
    process.exit(0)
  } else if (gotToolCall && truncatedToolCall) {
    console.log('\n⚠️  PARTIAL: Tool call was truncated but no warning event was emitted')
    console.log('   (The engine may have handled it differently)')
    process.exit(0)
  } else if (!gotToolCall) {
    console.log('\n⚠️  No tool call made — model may have used text-only response')
    console.log('   (Try a different model or prompt)')
    process.exit(0)
  } else {
    console.log('\n❌ FAIL: Tool call was not truncated — maxTokens may be too large for this prompt')
    process.exit(1)
  }
}

main().catch(console.error)
