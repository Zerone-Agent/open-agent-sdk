/**
 * Example 22: TodoWrite Tool
 *
 * Demonstrates how the agent uses TodoWrite to create and manage
 * a structured task list during a multi-step coding session.
 *
 * The agent will:
 * 1. Create a todo list with several tasks
 * 2. Work through each task, updating status as it goes
 * 3. Mark tasks completed in real-time
 *
 * Run: npx tsx examples/22-todowrite.ts
 */
import { createAgent } from '../src/index.js'

async function main() {
  console.log('--- Example 22: TodoWrite Tool ---\n')

  const agent = createAgent({
    model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
    maxTurns: 15,
  })

  const userPrompt =
    'Do the following tasks: ' +
    '1) List all .ts files in src/tools/ using Glob. ' +
    '2) Read src/tools/todo-tool.ts and summarize it in 2 sentences. ' +
    '3) Use Bash to count the total lines in src/tools/todo-tool.ts. ' +
    'Use TodoWrite to track these tasks and update progress as you work.'

  console.log('=== USER REQUEST ===')
  console.log(userPrompt)
  console.log('\n')

  let turnCount = 0

  function printTodoListFromJson(raw: string) {
    const jsonMatch = raw.match(/\n(\[[\s\S]*\])\s*$/)
    if (!jsonMatch) return
    try {
      const todos = JSON.parse(jsonMatch[1])
      console.log('\n=== TODO LIST ===')
      for (const t of todos) {
        const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '•' : t.status === 'cancelled' ? '✗' : ' '
        console.log(`[${mark}] ${t.content}`)
      }
    } catch {}
  }

  for await (const event of agent.query(userPrompt)) {
    const msg = event as any

    if (msg.type === 'assistant') {
      turnCount++
      console.log(`\n=== LLM RESPONSE (Turn ${turnCount}) ===`)
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          console.log(`\n[Tool Call] ${block.name}`)
          console.log(`  input: ${JSON.stringify(block.input, null, 2)}`)
        }
        if (block.type === 'text' && block.text.trim()) {
          console.log(`\n[Text Response]\n${block.text}`)
        }
      }
    }

    if (msg.type === 'tool_result') {
      const output = msg.result.output
      const truncated = output.length > 500 ? output.slice(0, 500) + '...(truncated)' : output
      console.log(`\n=== TOOL RESULT (${msg.result.tool_name}) ===`)
      console.log(truncated)

      if (msg.result.tool_name === 'TodoWrite') {
        printTodoListFromJson(output)
      }
    }

    if (msg.type === 'result') {
      console.log(`\n=== FINAL RESULT ===`)
      console.log(`  subtype: ${msg.subtype}`)
      console.log(`  num_turns: ${msg.num_turns}`)
      console.log(`  tokens: ${msg.usage?.input_tokens} in / ${msg.usage?.output_tokens} out`)
    }
  }

  agent[Symbol.asyncDispose]()
}

main().catch(console.error)
