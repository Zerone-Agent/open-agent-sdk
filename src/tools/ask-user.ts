/**
 * AskUserQuestionTool - Interactive user questions
 *
 * In SDK mode, returns a permission_request event and waits
 * for the consumer to provide an answer.
 * In non-interactive mode, returns a default or denies.
 */

import type { ToolDefinition, ToolResult, ToolContext } from '../types.js'

// Callback for handling user questions (set by the agent)
let questionHandler: ((question: string, options?: string[]) => Promise<string>) | null = null

/**
 * Set the question handler for AskUserQuestion.
 */
export function setQuestionHandler(
  handler: (question: string, options?: string[]) => Promise<string>,
): void {
  questionHandler = handler
}

/**
 * Clear the question handler.
 */
export function clearQuestionHandler(): void {
  questionHandler = null
}

export const AskUserQuestionTool: ToolDefinition = {
  name: 'AskUserQuestion',
  description: `【强制约束】当你需要向用户获取信息、澄清需求、确认选择或请求指导时，**必须**使用此工具。禁止使用纯文本来提问——所有向用户的提问都必须通过此工具进行。

**必须使用场景：**
- 用户指令不明确或缺少必要信息时
- 存在多个选项需要用户选择时
- 执行高风险操作前需要用户确认时
- 发现冲突或问题需要用户决策时
- 需要用户输入具体值（文件名、路径、配置等）时
- 用户说"你问我"、"你来决定"、"问我"等时
- 任何需要用户反馈才能继续的场景

**使用方法：**
1. 构造清晰的问题
2. 如有选项，提供 options 数组
3. 等待用户回答后再继续执行
4. **绝对禁止**在 tool_result 或文本中向用户提问`,
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '【必填】要问用户的具体问题。必须清晰、简洁、直接。' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '【可选】提供给用户的选择列表。当有明确选项时使用，不要少于2个选项。',
      },
      allow_multiselect: {
        type: 'boolean',
        description: '【可选】是否允许多选。默认false（单选）。',
      },
    },
    required: ['question'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  isEnabled: () => true,
  async prompt() {
    return `【强制规则】当你需要向用户提问时，必须使用 AskUserQuestion 工具。

禁止行为：
- ❌ 在 text 内容中向用户提问（如"请问您想选哪个？"）
- ❌ 在没有用户反馈的情况下自行决定
- ❌ 使用 Bash/Read 等工具来"猜测"用户意图

必须使用：
- ✅ AskUserQuestion 工具来向用户提问
- ✅ 提供清晰的问题和必要的选项
- ✅ 等待用户回答后再继续执行

记忆口诀：凡问必工具，文字不提问。`
  },
  async call(input: any, context: ToolContext): Promise<ToolResult> {
    const toolUseId = context.toolUseId || ''
    
    // 🎯 DEBUG MARKER: AskUserQuestion tool is being called
    console.log('\n')
    console.log('╔══════════════════════════════════════════════════════════════╗')
    console.log('║  🎯 ASKUSERQUESTION TOOL CALLED                              ║')
    console.log('╠══════════════════════════════════════════════════════════════╣')
    console.log(`║  Tool Use ID: ${toolUseId}`)
    console.log(`║  Question: ${input.question}`)
    console.log(`║  Options: ${input.options ? input.options.join(', ') : 'none'}`)
    console.log(`║  Handler Set: ${questionHandler ? 'YES ✅' : 'NO ❌'}`)
    console.log('╚══════════════════════════════════════════════════════════════╝')
    console.log('\n')
    
    if (questionHandler) {
      try {
        console.log('  ⏳ Waiting for user response...')
        const answer = await questionHandler(input.question, input.options)
        console.log('\n')
        console.log('╔══════════════════════════════════════════════════════════════╗')
        console.log('║  ✅ ASKUSERQUESTION SUCCESS                                  ║')
        console.log('╠══════════════════════════════════════════════════════════════╣')
        console.log(`║  Tool Use ID: ${toolUseId}`)
        console.log(`║  User Answer: ${answer}`)
        console.log('╚══════════════════════════════════════════════════════════════╝')
        console.log('\n')
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: answer,
        }
      } catch (err: any) {
        console.log('\n')
        console.log('╔══════════════════════════════════════════════════════════════╗')
        console.log('║  ❌ ASKUSERQUESTION FAILED                                   ║')
        console.log('╠══════════════════════════════════════════════════════════════╣')
        console.log(`║  Error: ${err.message}`)
        console.log('╚══════════════════════════════════════════════════════════════╝')
        console.log('\n')
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `User declined to answer: ${err.message}`,
          is_error: true,
        }
      }
    }

    // Non-interactive: return informative message
    console.log('  ⚠️  No handler set - returning non-interactive fallback')
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `[Non-interactive mode] Question: ${input.question}${input.options ? `\nOptions: ${input.options.join(', ')}` : ''}\n\nNo user available to answer. Proceeding with best judgment.`,
    }
  },
}
