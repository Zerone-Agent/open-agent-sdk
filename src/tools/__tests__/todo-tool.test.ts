import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext, ToolResult } from '../../types.js'

const mockContext: ToolContext = {
  cwd: '/tmp/test',
  agentId: 'test-agent',
  sessionId: 'test-session-001',
}

describe('TodoWriteTool', () => {
  let TodoWriteTool: typeof import('../todo-tool.js').TodoWriteTool
  let getTodos: typeof import('../todo-tool.js').getTodos
  let clearTodos: typeof import('../todo-tool.js').clearTodos

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../todo-tool.js')
    TodoWriteTool = mod.TodoWriteTool
    getTodos = mod.getTodos
    clearTodos = mod.clearTodos
  })

  describe('schema and metadata', () => {
    it('has correct tool name', () => {
      expect(TodoWriteTool.name).toBe('TodoWrite')
    })

    it('requires todos array in inputSchema', () => {
      expect(TodoWriteTool.inputSchema.required).toContain('todos')
    })

    it('defines status enum with 4 values', () => {
      const todoItemProps = TodoWriteTool.inputSchema.properties.todos.items.properties
      expect(todoItemProps.status.enum).toEqual(['pending', 'in_progress', 'completed', 'cancelled'])
    })

    it('defines priority enum with 3 values', () => {
      const todoItemProps = TodoWriteTool.inputSchema.properties.todos.items.properties
      expect(todoItemProps.priority.enum).toEqual(['high', 'medium', 'low'])
    })

    it('requires content, status, priority in each item', () => {
      const todoItemProps = TodoWriteTool.inputSchema.properties.todos.items
      expect(todoItemProps.required).toEqual(['content', 'status', 'priority'])
    })
  })

  describe('full-replace mode', () => {
    it('creates a new todo list from scratch', async () => {
      const result = await TodoWriteTool.call({
        todos: [
          { content: 'Task A', status: 'pending', priority: 'high' },
          { content: 'Task B', status: 'pending', priority: 'medium' },
        ],
      }, mockContext)

      expect(result.type).toBe('tool_result')
      expect(result.is_error).toBeFalsy()
      expect(result.content).toContain('Task A')
      expect(result.content).toContain('Task B')
    })

    it('replaces entire list on each call', async () => {
      await TodoWriteTool.call({
        todos: [
          { content: 'Old task', status: 'pending', priority: 'low' },
        ],
      }, mockContext)

      await TodoWriteTool.call({
        todos: [
          { content: 'New task', status: 'in_progress', priority: 'high' },
        ],
      }, mockContext)

      const todos = await getTodos('test-session-001')
      expect(todos).toHaveLength(1)
      expect(todos[0].content).toBe('New task')
    })

    it('handles empty todos array (clear all)', async () => {
      await TodoWriteTool.call({
        todos: [
          { content: 'Task', status: 'pending', priority: 'high' },
        ],
      }, mockContext)

      const result = await TodoWriteTool.call({ todos: [] }, mockContext)
      expect(result.is_error).toBeFalsy()

      const todos = await getTodos('test-session-001')
      expect(todos).toHaveLength(0)
    })
  })

  describe('session isolation', () => {
    it('keeps different sessions separate', async () => {
      const ctxA: ToolContext = { ...mockContext, sessionId: 'session-a' }
      const ctxB: ToolContext = { ...mockContext, sessionId: 'session-b' }

      await TodoWriteTool.call({
        todos: [{ content: 'Task A', status: 'pending', priority: 'high' }],
      }, ctxA)

      await TodoWriteTool.call({
        todos: [{ content: 'Task B', status: 'in_progress', priority: 'low' }],
      }, ctxB)

      const todosA = await getTodos('session-a')
      const todosB = await getTodos('session-b')

      expect(todosA).toHaveLength(1)
      expect(todosA[0].content).toBe('Task A')
      expect(todosB).toHaveLength(1)
      expect(todosB[0].content).toBe('Task B')
    })
  })

  describe('input validation', () => {
    it('rejects invalid status value', async () => {
      const result = await TodoWriteTool.call({
        todos: [{ content: 'Task', status: 'unknown', priority: 'high' }],
      }, mockContext)

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('status')
    })

    it('rejects invalid priority value', async () => {
      const result = await TodoWriteTool.call({
        todos: [{ content: 'Task', status: 'pending', priority: 'urgent' }],
      }, mockContext)

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('priority')
    })

    it('rejects empty content', async () => {
      const result = await TodoWriteTool.call({
        todos: [{ content: '', status: 'pending', priority: 'high' }],
      }, mockContext)

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('content')
    })

    it('rejects missing todos field', async () => {
      const result = await TodoWriteTool.call({}, mockContext)

      expect(result.is_error).toBe(true)
    })
  })

  describe('output formatting', () => {
    it('includes formatted text with status icons', async () => {
      const result = await TodoWriteTool.call({
        todos: [
          { content: 'Done task', status: 'completed', priority: 'high' },
          { content: 'Active task', status: 'in_progress', priority: 'medium' },
          { content: 'Pending task', status: 'pending', priority: 'low' },
          { content: 'Cancelled task', status: 'cancelled', priority: 'medium' },
        ],
      }, mockContext)

      expect(result.is_error).toBeFalsy()
      const output = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
      expect(output).toContain('Done task')
      expect(output).toContain('Active task')
      expect(output).toContain('Pending task')
      expect(output).toContain('Cancelled task')
    })

    it('includes JSON representation in output', async () => {
      const todos = [
        { content: 'Task 1', status: 'pending', priority: 'high' },
      ]

      const result = await TodoWriteTool.call({ todos }, mockContext)
      const output = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
      expect(output).toContain('"content"')
      expect(output).toContain('"status"')
      expect(output).toContain('"priority"')
    })

    it('shows count of incomplete todos', async () => {
      const result = await TodoWriteTool.call({
        todos: [
          { content: 'Task 1', status: 'completed', priority: 'high' },
          { content: 'Task 2', status: 'pending', priority: 'medium' },
          { content: 'Task 3', status: 'in_progress', priority: 'low' },
        ],
      }, mockContext)

      const output = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
      expect(output).toMatch(/2 todos/)
    })
  })

  describe('persistence', () => {
    it('survives module reload (reads from file)', async () => {
      await TodoWriteTool.call({
        todos: [
          { content: 'Persistent task', status: 'pending', priority: 'high' },
        ],
      }, mockContext)

      vi.resetModules()
      const mod2 = await import('../todo-tool.js')

      const todos = await mod2.getTodos('test-session-001')
      expect(todos).toHaveLength(1)
      expect(todos[0].content).toBe('Persistent task')
    })
  })

  describe('public API', () => {
    it('getTodos returns empty array for unknown session', async () => {
      const todos = await getTodos('nonexistent-session')
      expect(todos).toEqual([])
    })

    it('clearTodos removes all todos for a session', async () => {
      await TodoWriteTool.call({
        todos: [{ content: 'Task', status: 'pending', priority: 'high' }],
      }, mockContext)

      await clearTodos('test-session-001')

      const todos = await getTodos('test-session-001')
      expect(todos).toHaveLength(0)
    })
  })
})
