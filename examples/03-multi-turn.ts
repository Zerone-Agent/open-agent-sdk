/**
 * Example 3: Multi-Turn Conversation
 *
 * Demonstrates session persistence across multiple turns.
 * The agent remembers context from previous interactions.
 *
 * Run: npx tsx examples/03-multi-turn.ts
 */
import { createAgent } from '../src/index.js'

async function main() {
  console.log('--- Example 3: Multi-Turn Conversation ---\n')

  const agent = createAgent({
    model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
    maxTurns: 5,
  })

  console.log('> Turn 1: Create a file')
  const r1 = await agent.prompt(
    'Use Bash to run: echo "Hello Open Agent SDK" > /tmp/oas-test.txt. Confirm briefly.',
  )
  console.log(`  ${r1.text}`)
  console.log(`  Tokens: ${r1.usage.input_tokens} in / ${r1.usage.output_tokens} out | Cache read: ${r1.usage.cache_read_input_tokens ?? 0} / Cache creation: ${r1.usage.cache_creation_input_tokens ?? 0}\n`)

  // Turn 2: Read back (should remember context)
  console.log('> Turn 2: Read the file back')
  const r2 = await agent.prompt('Read the file you just created and tell me its contents.')
  console.log(`  ${r2.text}`)
  console.log(`  Tokens: ${r2.usage.input_tokens} in / ${r2.usage.output_tokens} out | Cache read: ${r2.usage.cache_read_input_tokens ?? 0} / Cache creation: ${r2.usage.cache_creation_input_tokens ?? 0}\n`)

  // Turn 3: Clean up
  console.log('> Turn 3: Cleanup')
  const r3 = await agent.prompt('Delete that file with Bash. Confirm.')
  console.log(`  ${r3.text}`)
  console.log(`  Tokens: ${r3.usage.input_tokens} in / ${r3.usage.output_tokens} out | Cache read: ${r3.usage.cache_read_input_tokens ?? 0} / Cache creation: ${r3.usage.cache_creation_input_tokens ?? 0}\n`)

  console.log(`Session history: ${agent.getMessages().length} messages`)
}

main().catch(console.error)
