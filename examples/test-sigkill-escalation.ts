/**
 * Test: SIGTERM → SIGKILL escalation on Bash subprocess
 *
 * The agent runs `sleep 30` (ignores SIGTERM), then we call interrupt()
 * after 2 seconds. The subprocess should be force-killed within ~1s
 * after the SIGTERM grace period.
 *
 * Run: npx tsx examples/test-sigkill-escalation.ts
 */
import { createAgent } from '../src/index.js'

async function main() {
  console.log('--- Test: SIGKILL Escalation ---\n')

  const agent = createAgent({
    model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
    maxTurns: 2,
  })

  const prompt = 'Run this exact command: bash -c "trap \'\' TERM; sleep 30". Do not add any explanation, just run it.'

  const t0 = Date.now()

  const queryPromise = (async () => {
    for await (const event of agent.query(prompt)) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      if (event.type === 'assistant') {
        for (const block of (event as any).message?.content || []) {
          if (block.type === 'tool_use') {
            console.log(`[${elapsed}s] Tool call: ${block.name}`)
          }
        }
      }
      if (event.type === 'tool_result') {
        console.log(`[${elapsed}s] Tool result (${(event as any).result.output.length} chars)`)
      }
      if (event.type === 'result') {
        console.log(`[${elapsed}s] Result: ${(event as any).subtype}`)
      }
    }
  })()

  setTimeout(async () => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`\n[${elapsed}s] >>> Calling interrupt() <<<\n`)
    await agent.interrupt()
  }, 5000)

  await queryPromise

  const total = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n[${total}s] Total time. Expected: ~6-7s (5s wait + ~1s SIGKILL grace)`)

  await agent.close()
}

main().catch(console.error)
