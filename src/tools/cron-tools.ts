/**
 * Cron/Scheduling Tools
 *
 * CronCreate, CronDelete, CronList - Schedule recurring tasks.
 * RemoteTrigger - Manage remote scheduled agent triggers.
 */

import type { ToolDefinition, ToolResult } from '../types.js'
import type { CronTask } from '../cron/types.js'
import type { CronStorage } from '../cron/storage.js'
import {
  parseCronExpression,
  computeNextCronRun,
  cronToHuman,
} from '../cron/cron.js'

let storage: CronStorage | null = null

export type CronJob = CronTask

export function initCronTools(storageImpl: CronStorage): void {
  storage = storageImpl
}

function notInitializedResult(): ToolResult {
  return {
    type: 'tool_result',
    tool_use_id: '',
    content: 'Cron storage is not initialized.',
    is_error: true,
  }
}

function formatPrompt(prompt: string): string {
  return prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt
}

/**
 * Get all cron jobs.
 */
export async function getAllCronJobs(): Promise<CronTask[]> {
  if (!storage) return []
  return storage.load()
}

/**
 * Clear all cron jobs.
 */
export async function clearCronJobs(): Promise<void> {
  if (!storage) return
  await storage.save([])
}

export const CronCreateTool: ToolDefinition = {
  name: 'CronCreate',
  description: 'Create a scheduled cron task. Supports cron expressions for scheduling.',
  inputSchema: {
    type: 'object',
    properties: {
      cron: { type: 'string', description: 'Cron expression (for example, "*/5 * * * *" for every 5 minutes)' },
      prompt: { type: 'string', description: 'Prompt to execute when the task fires' },
      recurring: { type: 'boolean', description: 'Whether the task should repeat after firing' },
      durable: { type: 'boolean', description: 'Whether the task should survive expiry cleanup' },
    },
    required: ['cron', 'prompt', 'recurring'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  isEnabled: () => true,
  async prompt() { return 'Create a scheduled cron task.' },
  async call(input: any): Promise<ToolResult> {
    const cronStorage = storage
    if (!cronStorage) return notInitializedResult()

    if (typeof input?.cron !== 'string' || typeof input?.prompt !== 'string' || typeof input?.recurring !== 'boolean') {
      return {
        type: 'tool_result',
        tool_use_id: '',
        content: 'CronCreate requires cron, prompt, and recurring fields.',
        is_error: true,
      }
    }

    const fields = parseCronExpression(input.cron)
    if (!fields) {
      return {
        type: 'tool_result',
        tool_use_id: '',
        content: `Invalid cron expression: ${input.cron}`,
        is_error: true,
      }
    }

    const nextRun = computeNextCronRun(fields, new Date())
    if (!nextRun) {
      return {
        type: 'tool_result',
        tool_use_id: '',
        content: `Cron expression has no matching run time within 366 days: ${input.cron}`,
        is_error: true,
      }
    }

    const tasks = await cronStorage.load()
    if (tasks.length >= 50) {
      return {
        type: 'tool_result',
        tool_use_id: '',
        content: 'Cron task limit reached: maximum 50 tasks.',
        is_error: true,
      }
    }

    const task: Omit<CronTask, 'id' | 'createdAt'> = {
      cron: input.cron,
      prompt: input.prompt,
      recurring: input.recurring,
    }
    if (typeof input.durable === 'boolean') {
      task.permanent = input.durable
    }

    const id = await cronStorage.add(task)
    const description = cronToHuman(input.cron)

    return {
      type: 'tool_result',
      tool_use_id: '',
      content: `Cron task created: ${id} (${description}). Next run: ${nextRun.toISOString()}`,
    }
  },
}

export const CronDeleteTool: ToolDefinition = {
  name: 'CronDelete',
  description: 'Delete a scheduled cron task.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Cron task ID to delete' },
    },
    required: ['id'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  isEnabled: () => true,
  async prompt() { return 'Delete a cron task.' },
  async call(input: any): Promise<ToolResult> {
    const cronStorage = storage
    if (!cronStorage) return notInitializedResult()

    if (typeof input?.id !== 'string') {
      return {
        type: 'tool_result',
        tool_use_id: '',
        content: 'CronDelete requires an id field.',
        is_error: true,
      }
    }

    const tasks = await cronStorage.load()
    if (!tasks.some((task) => task.id === input.id)) {
      return { type: 'tool_result', tool_use_id: '', content: `Cron task not found: ${input.id}`, is_error: true }
    }

    await cronStorage.remove([input.id])
    return { type: 'tool_result', tool_use_id: '', content: `Cron task deleted: ${input.id}` }
  },
}

export const CronListTool: ToolDefinition = {
  name: 'CronList',
  description: 'List all scheduled cron tasks.',
  inputSchema: { type: 'object', properties: {} },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isEnabled: () => true,
  async prompt() { return 'List cron tasks.' },
  async call(): Promise<ToolResult> {
    const cronStorage = storage
    if (!cronStorage) return notInitializedResult()

    const tasks = await cronStorage.load()
    if (tasks.length === 0) {
      return { type: 'tool_result', tool_use_id: '', content: 'No cron tasks scheduled.' }
    }

    const lines = tasks.map((task) =>
      `[${task.id}] ${cronToHuman(task.cron)} (${task.recurring ? 'recurring' : 'one-shot'}${task.permanent ? ', durable' : ''}) cron="${task.cron}" prompt="${formatPrompt(task.prompt)}"`
    )
    return { type: 'tool_result', tool_use_id: '', content: lines.join('\n') }
  },
}

export const RemoteTriggerTool: ToolDefinition = {
  name: 'RemoteTrigger',
  description: 'Manage remote scheduled agent triggers. Supports list, get, create, update, and run operations.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'create', 'update', 'run'],
        description: 'Operation to perform',
      },
      id: { type: 'string', description: 'Trigger ID (for get/update/run)' },
      name: { type: 'string', description: 'Trigger name (for create)' },
      schedule: { type: 'string', description: 'Cron schedule (for create/update)' },
      prompt: { type: 'string', description: 'Agent prompt (for create/update)' },
    },
    required: ['action'],
  },
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  isEnabled: () => true,
  async prompt() { return 'Manage remote agent triggers.' },
  async call(input: any): Promise<ToolResult> {
    // RemoteTrigger operations are typically handled by the remote backend
    // In standalone SDK mode, we provide a stub implementation
    return {
      type: 'tool_result',
      tool_use_id: '',
      content: `RemoteTrigger ${input.action}: This feature requires a connected remote backend. In standalone SDK mode, use CronCreate/CronList/CronDelete for local scheduling.`,
    }
  },
}
