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
    model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
    maxTurns: 10,
    includePartialMessages: true,
    thinking: { type: 'enabled', budgetTokens: 2000 },
  })

  const userPrompt = '27 乘以 43 等于多少？请展示你的推理过程。'

  console.log('=== USER PROMPT ===')
  console.log(userPrompt)
  console.log('\n=== EXISTING MESSAGES ===')
  for (const msg of agent.getMessages()) {
    const role = (msg as any).role || msg.type
    const content = (msg as any).message?.content || (msg as any).content
    if (typeof content === 'string') {
      console.log(`\n[${role}] ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') {
          console.log(`\n[${role}/text] ${block.text.slice(0, 500)}${block.text.length > 500 ? '...' : ''}`)
        } else if (block.type === 'tool_use') {
          console.log(`\n[${role}/tool_use] ${block.name}(${JSON.stringify(block.input).slice(0, 200)})`)
        } else if (block.type === 'tool_result') {
          console.log(`\n[${role}/tool_result] ${block.content?.slice(0, 200)}`)
        } else {
          console.log(`\n[${role}/${block.type}] ${JSON.stringify(block).slice(0, 200)}`)
        }
      }
    }
  }
  console.log('\n=== END ===\n')

  let lastType = ''

  for await (const event of agent.query(userPrompt)) {
    switch (event.type) {
      case 'partial_message': {
        if (event.partial.type === 'text') {
          if (lastType === 'thinking') {
            process.stdout.write('\n\n')
          }
          process.stdout.write(event.partial.text)
        }
        if (event.partial.type === 'thinking') {
          process.stdout.write(`\x1b[90m${event.partial.text}\x1b[0m`)
        }
        lastType = event.partial.type
        break
      }
      case 'assistant': {
        console.log('\n\n[Complete message received]')
        break
      }
      case 'result': {
        console.log(`\n--- Result: ${event.subtype} ---`)
        console.log(`Tokens: ${event.usage?.input_tokens} in / ${event.usage?.output_tokens} out`)
        console.log(`Cache read: ${event.usage?.cache_read_input_tokens ?? 0} / Cache creation: ${event.usage?.cache_creation_input_tokens ?? 0}`)
        if (event.errors) {
          console.log(`Errors: ${event.errors.join(', ')}`)
        }
      }
    }
  }

  console.log('\n')
}

main().catch(console.error)