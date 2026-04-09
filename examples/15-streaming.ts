/**
 * Example 15: Streaming Output
 *
 * Demonstrates token-level streaming with partial messages.
 *
 * Run: npx tsx examples/15-streaming.ts
 */
import { createAgent } from '../src/index.js'

async function main() {
  console.log('--- Example 15: Streaming Output ---\n')

  const agent = createAgent({
    model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
    maxTurns: 10,
    includePartialMessages: true,
    thinking: { type: 'enabled', budgetTokens: 2000 },
  })

  let partialText = ''
  let thinkingText = ''

  for await (const event of agent.query(
    'What is 27 * 43? Show your reasoning.',
  )) {
    switch (event.type) {
      case 'partial_message': {
        if (event.partial.type === 'text') {
          partialText += event.partial.text
          process.stdout.write(event.partial.text)
        }
        if (event.partial.type === 'thinking') {
          thinkingText += event.partial.text
        }
        break
      }
      case 'assistant': {
        console.log('\n\n[Complete message received]')
        break
      }
      case 'result': {
        console.log(`\n--- Result: ${event.subtype} ---`)
        console.log(`Tokens: ${event.usage?.input_tokens} in / ${event.usage?.output_tokens} out`)
        console.log(`Complete text length: ${partialText.length} chars`)
        if (thinkingText) {
          console.log(`\n=== Thinking (推理过程) ===`)
          console.log(thinkingText)
        }
        if (event.errors) {
          console.log(`Errors: ${event.errors.join(', ')}`)
        }
      }
    }
  }

  console.log('\n')
}

main().catch(console.error)