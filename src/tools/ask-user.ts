/**
 * AskUserQuestionTool - Interactive user questions
 *
 * In SDK mode, returns a permission_request event and waits
 * for the consumer to provide an answer.
 * In non-interactive mode, returns a default or denies.
 */

import type { ToolDefinition, ToolResult } from '../types.js'

// Callback for handling user questions (set by the agent)
let questionHandler: ((question: string, options: string[], allowMultiselect?: boolean) => Promise<string>) | null = null

/**
 * Set the question handler for AskUserQuestion.
 */
export function setQuestionHandler(
  handler: (question: string, options: string[], allowMultiselect?: boolean) => Promise<string>,
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
  description: `Ask the user a question with required choices. When your question has clear options for the user to select, prefer this tool over asking directly in plain text.

Useful when you need the user to make a choice or provide input. For interactive sessions (stories, quizzes, games), use this tool to present each question one at a time.

Requirements:
- MUST provide at least 2 options for the user to choose from
- Call AskUserQuestion once per question — show only the current question
- After the user answers, determine the next question based on their response
- Progress step by step until all questions are completed
IMPORTANT: This tool does NOT support asking multiple questions at once. Each call asks ONE question only. If you have multiple questions, call this tool multiple times, one question per call.`,
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user. Ask only one question at a time.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'Required choices for the user to select from. Must provide at least 2 options.',
      },
      allow_multiselect: {
        type: 'boolean',
        description: 'Whether to allow multiple selections',
      },
    },
    required: ['question', 'options'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => false,
  isEnabled: () => true,
  async prompt() { return 'Ask the user a question with required choices. One question at a time for interactive Q&A.' },
  async call(input: any): Promise<ToolResult> {
    if (!input.options || !Array.isArray(input.options) || input.options.length < 2) {
      return {
        type: 'tool_result',
        tool_use_id: '',
        content: 'Error: options must be an array with at least 2 items.',
        is_error: true,
      }
    }

    if (questionHandler) {
      try {
        const answer = await questionHandler(input.question, input.options, input.allow_multiselect)
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
      content: `[Non-interactive mode] Question: ${input.question}\nOptions: ${input.options.join(', ')}\n\nNo user available to answer. Proceeding with best judgment.`,
    }
  },
}
