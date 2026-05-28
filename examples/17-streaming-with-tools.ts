/**
 * Example 17: Streaming with Tool Calls
 *
 * Demonstrates streaming output combined with tool execution,
 * including the tool_use partial notification for long parameter streaming.
 *
 * Run: npx tsx examples/17-streaming-with-tools.ts
 */
import { createAgent, BashTool, FileReadTool, FileWriteTool } from '../src/index.js'
import type { ToolDefinition } from '../src/types.js'

const tools: ToolDefinition[] = [BashTool, FileReadTool, FileWriteTool]

async function main() {
  console.log('--- Example 17: Streaming with Tool Calls ---\n')

  const agent = createAgent({
    model: process.env.OPENAGENT_MODEL || 'claude-sonnet-4-6',
    maxTurns: 10,
    includePartialMessages: true,
    thinking: { type: 'enabled', budgetTokens: 2000 },
    tools,
  })

  const queries = [
    '使用 Read 工具读取当前目录下的 package.json 文件，告诉我项目名称和版本号。',
    '用 Write 工具在 /tmp 目录下创建一个文件 sdk-test-output.ts，内容是一个包含 10 个工具函数的 TypeScript 模块，每个函数都要有完整的 JSDoc 注释、参数类型定义、错误处理逻辑和返回值说明。文件开头还要加上详细的模块说明注释。',
  ]

  for (const [qi, prompt] of queries.entries()) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Query ${qi + 1}: ${prompt.slice(0, 80)}...`)
    console.log('='.repeat(60))

    let lastType = ''

    for await (const event of agent.query(prompt)) {
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
          if (event.partial.type === 'tool_use') {
            if (lastType !== 'tool_use') process.stdout.write('\n\n')
            process.stdout.write(`\x1b[33m⏳ Preparing tool call: ${event.partial.tool_name}...\x1b[0m`)
          }
          lastType = event.partial.type
          break
        }
        case 'assistant': {
          const toolUses = (event.message?.content || []).filter(
            (block: any) => block.type === 'tool_use',
          )
          if (toolUses.length > 0) {
            const inputSizes = toolUses.map((t: any) => {
              const json = JSON.stringify(t.input)
              return `${t.name}: ${json.length} chars`
            })
            console.log(`\n\n[Tool Calls] ${inputSizes.join(', ')}`)
          }
          break
        }
        case 'tool_result': {
          console.log(`\n[Tool Result] ${event.result.tool_name} (${event.result.output.length} chars)`)
          break
        }
        case 'result': {
          console.log(`\n\n--- Result: ${event.subtype} ---`)
          console.log(`Tokens: ${event.usage?.input_tokens} in / ${event.usage?.output_tokens} out`)
          console.log(`Turns: ${event.num_turns}`)
          if (event.errors) {
            console.log(`Errors: ${event.errors.join(', ')}`)
          }
          break
        }
      }
    }
  }

  console.log('\n')
  await agent.close()
}

main().catch(console.error)
