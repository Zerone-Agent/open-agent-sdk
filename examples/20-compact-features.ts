/**
 * Example 20: Compact Features Test
 *
 * Tests the following features:
 * 1. contextWindow parameter for custom model context sizing
 * 2. Exact token counting (input_tokens + output_tokens from API)
 * 3. Pruning: old tool results > 20K chars replaced with placeholder
 * 4. Streaming compact events (start / progress / end)
 * 5. Structured summary template (Goal / Instructions / Discoveries / Accomplished / Files)
 *
 * Run: npx tsx examples/20-compact-features.ts
 */
import { createAgent } from '../src/index.js'

const CONTEXT_WINDOW = 40_000

async function main() {
  console.log('=== Compact Features Test ===\n')
  console.log(`contextWindow: ${CONTEXT_WINDOW.toLocaleString()}`)
  console.log(`compact threshold: ${(CONTEXT_WINDOW - 20_000).toLocaleString()} tokens\n`)

  const agent = createAgent({
    model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
    contextWindow: CONTEXT_WINDOW,
    maxTurns: 20,
  })

  const prompt = `Please perform these tasks in order, one at a time:
1. Read src/utils/compact.ts and summarize what it does
2. Read src/utils/tokens.ts and explain the token estimation
3. Read src/engine.ts lines 1-200 and describe the QueryEngine class
4. Read src/utils/messages.ts and explain message normalization
5. Read src/types.ts lines 1-200 and list the key types
6. Read package.json and describe the project
After reading each file, provide a brief summary before moving to the next.`

  console.log(`USER: ${prompt}\n`)

  let compactStreaming = false
  let turnCount = 0
  let compactCount = 0

  for await (const event of agent.query(prompt)) {
    switch (event.type) {
      case 'compact': {
        const e = event as any
        if (e.phase === 'start') {
          compactCount++
          compactStreaming = true
          console.log(`\n${'─'.repeat(60)}`)
          console.log(`📦 COMPACT #${compactCount} STARTED`)
          console.log('─'.repeat(60))
        } else if (e.phase === 'progress') {
          process.stdout.write(e.text || '')
        } else if (e.phase === 'end') {
          compactStreaming = false
          if (e.summary) {
            console.log('\n\n📦 COMPACT COMPLETE — structured summary above')
          } else {
            console.log('\n\n📦 COMPACT FAILED (empty summary)')
          }
          console.log('─'.repeat(60) + '\n')
        }
        break
      }

      case 'assistant': {
        turnCount++
        for (const block of (event as any).message?.content || []) {
          if (block.type === 'tool_use') {
            console.log(`\n🔧 [Turn ${turnCount}] Tool Call: ${block.name}(${JSON.stringify(block.input).slice(0, 120)}...)`)
          }
          if (block.type === 'text') {
            console.log(`\n💬 [Turn ${turnCount}] ${block.text.slice(0, 200)}${block.text.length > 200 ? '...' : ''}`)
          }
        }
        break
      }

      case 'tool_result': {
        const output: string = (event as any).result.output
        const toolName: string = (event as any).result.tool_name
        const pruned = output === '[Old tool result content cleared]'
        const oldTruncated = output.includes('...(truncated)...')
        console.log(`\n📋 [${toolName}] ${pruned ? '⚠️ PRUNED' : oldTruncated ? '✂️ TRUNCATED' : `${output.length.toLocaleString()} chars`}: ${output.slice(0, 80)}${output.length > 80 ? '...' : ''}`)
        break
      }

      case 'result': {
        const e = event as any
        console.log(`\n${'═'.repeat(60)}`)
        console.log(`FINAL RESULT: ${e.subtype}`)
        console.log(`Turns: ${e.num_turns}`)
        console.log(`Compacts triggered: ${compactCount}`)
        console.log(`Tokens: ${e.usage?.input_tokens?.toLocaleString()} in / ${e.usage?.output_tokens?.toLocaleString()} out`)
        if (e.errors?.length) {
          console.log(`Errors: ${e.errors.join(', ')}`)
        }
        console.log('═'.repeat(60))
        break
      }
    }
  }

  await agent.close()
}

main().catch(console.error)
