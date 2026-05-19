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
3. Read src/engine.ts and describe the QueryEngine class
4. Read src/utils/messages.ts and explain message normalization
5. Read src/types.ts and list the key types
6. Read src/providers/anthropic.ts and explain the Anthropic provider
7. Read src/providers/openai.ts and explain the OpenAI provider
8. Read src/providers/types.ts and explain provider types
9. Read src/agent.ts and explain the Agent class
10. Read src/tools/index.ts and list available tools
11. Read src/tools/bash.ts and explain the Bash tool
12. Read src/tools/read.ts and explain the Read tool
13. Read src/tools/edit.ts and explain the Edit tool
14. Read src/tools/write.ts and explain the Write tool
15. Read src/tools/glob.ts and explain the Glob tool
16. Read src/tools/grep.ts and explain the Grep tool
17. Read src/prompts/system-prompts.ts and explain system prompts
18. Read package.json and describe the project
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
        const u = (event as any).usage
        if (u) {
          console.log(`  📊 Tokens: ${(u.totalInputTokens ?? u.input_tokens)?.toLocaleString()} in / ${u.output_tokens?.toLocaleString()} out | Cache read: ${u.cache_read_input_tokens ?? 0} / Cache creation: ${u.cache_creation_input_tokens ?? 0}`)
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
        console.log(`Tokens: ${(e.usage?.totalInputTokens ?? e.usage?.input_tokens)?.toLocaleString()} in / ${e.usage?.output_tokens?.toLocaleString()} out`)
        console.log(`Cache read: ${(e.usage?.cache_read_input_tokens ?? 0).toLocaleString()} / Cache creation: ${(e.usage?.cache_creation_input_tokens ?? 0).toLocaleString()}`)
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
