import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoInfo {
  content: string
  status: TodoStatus
  priority: TodoPriority
}

const VALID_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed', 'cancelled']
const VALID_PRIORITIES: readonly string[] = ['high', 'medium', 'low']

let _description = ''

async function loadDescription(): Promise<string> {
  if (_description) return _description
  try {
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const { readFile } = await import('node:fs/promises')
    _description = await readFile(join(__dirname, 'todowrite.txt'), 'utf-8')
  } catch {
    _description = 'Manage a structured task list for your current coding session.'
  }
  return _description
}

function getTodosDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  return join(home, '.openagent', 'sessions')
}

function getTodosPath(sessionId: string): string {
  return join(getTodosDir(), sessionId, 'todos.json')
}

interface TodoFile {
  updatedAt: string
  todos: TodoInfo[]
}

function validateSessionId(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}. Must match /^[a-zA-Z0-9_-]+$/`)
  }
  return sessionId
}

async function saveTodos(sessionId: string, todos: TodoInfo[]): Promise<void> {
  validateSessionId(sessionId)
  const dir = join(getTodosDir(), sessionId)
  await mkdir(dir, { recursive: true })

  const data: TodoFile = {
    updatedAt: new Date().toISOString(),
    todos,
  }

  await writeFile(getTodosPath(sessionId), JSON.stringify(data, null, 2), 'utf-8')
}

async function loadTodos(sessionId: string): Promise<TodoInfo[]> {
  validateSessionId(sessionId)
  try {
    const raw = await readFile(getTodosPath(sessionId), 'utf-8')
    const data = JSON.parse(raw) as TodoFile
    return data.todos || []
  } catch {
    return []
  }
}

function validateTodos(todos: any[]): string | null {
  if (!Array.isArray(todos)) return 'todos must be an array'

  for (let i = 0; i < todos.length; i++) {
    const item = todos[i]
    if (!item.content || typeof item.content !== 'string' || item.content.trim() === '') {
      return `todos[${i}].content must be a non-empty string`
    }
    if (!VALID_STATUSES.includes(item.status)) {
      return `todos[${i}].status must be one of: ${VALID_STATUSES.join(', ')}`
    }
    if (!VALID_PRIORITIES.includes(item.priority)) {
      return `todos[${i}].priority must be one of: ${VALID_PRIORITIES.join(', ')}`
    }
  }

  const inProgressCount = todos.filter((t: any) => t.status === 'in_progress').length
  if (inProgressCount > 1) {
    return `Warning: ${inProgressCount} tasks are in_progress. Only one should be in_progress at a time.`
  }

  return null
}

const STATUS_ICONS: Record<TodoStatus, string> = {
  pending: '\u2610',
  in_progress: '\u29D6',
  completed: '\u2713',
  cancelled: '\u2717',
}

function formatTodos(todos: TodoInfo[]): string {
  if (todos.length === 0) return 'No todos.'

  const incomplete = todos.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length
  const lines: string[] = [`${incomplete} todo${incomplete !== 1 ? 's' : ''}:`]

  for (const t of todos) {
    const icon = STATUS_ICONS[t.status]
    lines.push(`  ${icon} ${t.content} (${t.priority}) [${t.status}]`)
  }

  return lines.join('\n')
}

export async function getTodos(sessionId: string): Promise<TodoInfo[]> {
  return loadTodos(sessionId)
}

export async function clearTodos(sessionId: string): Promise<void> {
  await saveTodos(sessionId, [])
}

export const TodoWriteTool: ToolDefinition = {
  name: 'TodoWrite',
  description: 'Manage a structured task list for your current coding session. See prompt for detailed usage instructions.',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The updated todo list',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Brief description of the task' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              description: 'Current status of the task',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Priority level of the task',
            },
          },
          required: ['content', 'status', 'priority'],
        },
      },
    },
    required: ['todos'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  isEnabled: () => true,
  async prompt() {
    return loadDescription()
  },
  async call(input: any, context: ToolContext): Promise<ToolResult> {
    const todos = input.todos
    if (!Array.isArray(todos)) {
      return { type: 'tool_result', tool_use_id: '', content: 'todos must be an array', is_error: true }
    }

    const validationError = validateTodos(todos)
    if (validationError && validationError.startsWith('todos[')) {
      return { type: 'tool_result', tool_use_id: '', content: validationError, is_error: true }
    }

    const sessionId = context.sessionId || 'default'

    try {
      validateSessionId(sessionId)
    } catch (e: any) {
      return { type: 'tool_result', tool_use_id: '', content: e.message, is_error: true }
    }

    await saveTodos(sessionId, todos)

    const formatted = formatTodos(todos)
    const json = JSON.stringify(todos, null, 2)
    const output = `${formatted}\n\n${json}`

    const warning = validationError ? `\n\nNote: ${validationError}` : ''

    return {
      type: 'tool_result',
      tool_use_id: '',
      content: output + warning,
    }
  },
}
