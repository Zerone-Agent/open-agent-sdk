/**
 * AskUserQuestionTool - Interactive user questions
 *
 * In SDK mode, returns a permission_request event and waits
 * for the consumer to provide an answer.
 * In non-interactive mode, returns a default or denies.
 */

import type { ToolDefinition, ToolResult } from '../types.js'

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
  description: `Ask the user a question. Displays a popup with optional choices. The user can pick an option, type a custom answer, go back to the previous question, or exit.

Useful when you need the user to make a choice or provide input. For interactive sessions (stories, quizzes, games), use this tool to present each question one at a time.

If the user's answer is "__BACK__", it means they want to return to the previous question and change their answer. In this case, re-ask the previous question and adjust your content (story direction, analysis, etc.) based on the new answer.`,
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Choices for the user to select from. Provide when there are specific options to choose from.',
      },
      allow_multiselect: {
        type: 'boolean',
        description: 'Whether to allow multiple selections',
      },
    },
    required: ['question'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => false,
  isEnabled: () => true,
  async prompt() { return 'Ask the user a question with optional choices. One question at a time for interactive Q&A.' },
  async call(input: any): Promise<ToolResult> {
    if (questionHandler) {
      try {
        const answer = await questionHandler(input.question, input.options || [])
        return {
          type: 'tool_result',
          tool_use_id: '',
          content: answer,
        }
      } catch (err: any) {
        return {
          type: 'tool_result',
          tool_use_id: '',
          content: `User declined to answer: ${err.message}`,
          is_error: true,
        }
      }
    }

    // Non-interactive: return informative message
    return {
      type: 'tool_result',
      tool_use_id: '',
      content: `[Non-interactive mode] Question: ${input.question}${input.options ? `\nOptions: ${input.options.join(', ')}` : ''}\n\nNo user available to answer. Proceeding with best judgment.`,
    }
  },
}
