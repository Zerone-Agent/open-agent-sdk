import { describe, expect, it, vi, beforeEach } from 'vitest'

import type { MemoryProvider, MemorySearchResult, SessionInfo, MessageInfo } from '../provider.js'
import {
  MemoryTool,
  SessionSearchTool,
  initMemoryTools,
} from '../memory-tools.js'

const toolContext = { cwd: process.cwd(), agentId: 'main' }

function createMockProvider() {
  return {
    add: vi.fn<() => Promise<{ ok: boolean; message: string }>>(),
    replace: vi.fn<() => Promise<{ ok: boolean; message: string }>>(),
    remove: vi.fn<() => Promise<{ ok: boolean; message: string }>>(),
    getAll: vi.fn<() => Promise<never[]>>(),
    getStats: vi.fn<() => Promise<{ used: number; limit: number; percentage: number }>>(),
    renderSnapshot: vi.fn<() => Promise<string>>(),
    search: vi.fn<() => Promise<MemorySearchResult[]>>(),
    listSessions: vi.fn<() => Promise<SessionInfo[]>>(),
    getMessages: vi.fn<() => Promise<MessageInfo[]>>(),
  }
}

describe('initMemoryTools', () => {
  it('sets the provider for tools to use', async () => {
    const provider = createMockProvider()
    provider.add.mockResolvedValue({ ok: true, message: '已添加。' })

    initMemoryTools(provider as MemoryProvider)

    const result = await MemoryTool.call(
      { action: 'add', target: 'memory', content: 'test note' },
      toolContext,
    )

    expect(provider.add).toHaveBeenCalledTimes(1)
    expect(provider.add).toHaveBeenCalledWith('main', 'memory', 'test note')
    expect(result.type).toBe('tool_result')
    expect(result.content).toBe('已添加。')
    expect(result.is_error).toBe(false)
  })
})

describe('MemoryTool', () => {
  let provider: ReturnType<typeof createMockProvider>

  beforeEach(() => {
    provider = createMockProvider()
    initMemoryTools(provider as MemoryProvider)
  })

  it('returns "not initialized" when called before init', async () => {
    initMemoryTools(null as unknown as MemoryProvider)

    const result = await MemoryTool.call(
      { action: 'add', target: 'memory', content: 'x' },
      { cwd: process.cwd(), agentId: 'main' },
    )

    expect(result.type).toBe('tool_result')
    expect(result.content).toBe('记忆系统尚未初始化。')
    expect(provider.add).not.toHaveBeenCalled()
  })

  it('delegates add action to provider.add with agentId', async () => {
    provider.add.mockResolvedValue({ ok: true, message: '已添加。' })

    const result = await MemoryTool.call(
      { action: 'add', target: 'memory', content: 'project uses React' },
      { cwd: process.cwd(), agentId: 'explore' },
    )

    expect(provider.add).toHaveBeenCalledWith('explore', 'memory', 'project uses React')
    expect(result.content).toBe('已添加。')
  })

  it('delegates replace action to provider.replace with agentId', async () => {
    provider.replace.mockResolvedValue({ ok: true, message: '已替换。' })

    const result = await MemoryTool.call(
      { action: 'replace', target: 'user', old_text: 'likes short replies', new_text: 'prefers detailed answers' },
      { cwd: process.cwd(), agentId: 'main' },
    )
    
    expect(provider.replace).toHaveBeenCalledWith('main', 'user', 'likes short replies', 'prefers detailed answers')
    expect(result.content).toBe('已替换。')
  })

  it('delegates remove action to provider.remove with agentId', async () => {
    provider.remove.mockResolvedValue({ ok: true, message: '已删除。' })

    const result = await MemoryTool.call(
      { action: 'remove', target: 'memory', old_text: 'obsolete note' },
      { cwd: process.cwd(), agentId: 'main' },
    )

    expect(provider.remove).toHaveBeenCalledWith('main', 'memory', 'obsolete note')
    expect(result.content).toBe('已删除。')
  })

  it('returns consolidation guidance for consolidate action', async () => {
    const result = await MemoryTool.call(
      { action: 'consolidate', target: 'memory' },
      toolContext,
    )

    expect(result.content).toBe('请通过 remove + add 的方式合并相关条目。')
    expect(provider.add).not.toHaveBeenCalled()
    expect(provider.remove).not.toHaveBeenCalled()
  })

  it('returns error for unknown action', async () => {
    const result = await MemoryTool.call(
      { action: 'unknown' as string, target: 'memory' },
      toolContext,
    )

    expect(result.content).toBe('未知操作：unknown')
  })
})

describe('SessionSearchTool', () => {
  let provider: ReturnType<typeof createMockProvider>

  beforeEach(() => {
    provider = createMockProvider()
    initMemoryTools(provider as MemoryProvider)
  })

  it('returns "not available" when called before init', async () => {
    initMemoryTools(null as unknown as MemoryProvider)

    const result = await SessionSearchTool.call(
      { action: 'search', query: 'hello' },
      toolContext,
    )

    expect(result.type).toBe('tool_result')
    expect(result.content).toBe('会话搜索不可用。')
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('rejects empty query for search action', async () => {
    const result = await SessionSearchTool.call(
      { action: 'search', query: '' },
      toolContext,
    )

    expect(result.content).toBe('请提供搜索关键词。')
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('delegates search action to provider.search', async () => {
    provider.search.mockResolvedValue([
      {
        messageId: 'msg-1',
        content: 'Hello world',
        sessionId: 'session-1',
        role: 'user',
        createdAt: '2026-05-25 12:00:00',
      },
    ])

    const result = await SessionSearchTool.call(
      { action: 'search', query: 'hello', limit: 5, offset: 0 },
      toolContext,
    )

    expect(provider.search).toHaveBeenCalledWith('hello', { limit: 5, offset: 0 })
    expect(result.content).toBe('[2026-05-25 12:00:00] user: Hello world')
  })

  it('returns "no results" when search finds nothing', async () => {
    provider.search.mockResolvedValue([])

    const result = await SessionSearchTool.call(
      { action: 'search', query: 'nothing' },
      toolContext,
    )

    expect(result.content).toBe('未找到匹配的消息。')
  })

  it('formats multiple results separated by ---', async () => {
    provider.search.mockResolvedValue([
      {
        messageId: 'msg-1',
        content: 'First match',
        sessionId: 'session-1',
        role: 'user',
        createdAt: '2026-05-25 12:00:00',
      },
      {
        messageId: 'msg-2',
        content: 'Second match',
        sessionId: 'session-1',
        role: 'assistant',
        createdAt: '2026-05-25 12:01:00',
      },
    ])

    const result = await SessionSearchTool.call(
      { action: 'search', query: 'match' },
      toolContext,
    )

    expect(result.content).toBe(
      '[2026-05-25 12:00:00] user: First match\n' +
      '---\n' +
      '[2026-05-25 12:01:00] assistant: Second match',
    )
  })

  it('calls search with provided query when limit/offset omitted', async () => {
    provider.search.mockResolvedValue([])

    await SessionSearchTool.call(
      { action: 'search', query: 'test' },
      toolContext,
    )

    expect(provider.search).toHaveBeenCalledWith('test', { limit: undefined, offset: undefined })
  })

  it('delegates list_sessions action to provider.listSessions', async () => {
    provider.listSessions.mockResolvedValue([
      {
        id: 'session-1',
        title: '项目讨论',
        model: 'claude-4',
        createdAt: '2026-05-25 10:00:00',
        messageCount: 15,
      },
      {
        id: 'session-2',
        title: 'Bug 修复',
        createdAt: '2026-05-24 14:00:00',
        messageCount: 8,
      },
    ])

    const result = await SessionSearchTool.call(
      { action: 'list_sessions', limit: 5, offset: 0 },
      toolContext,
    )

    expect(provider.listSessions).toHaveBeenCalledWith({
      dateFrom: undefined,
      dateTo: undefined,
      limit: 5,
      offset: 0,
    })
    expect(result.content).toBe(
      '[2026-05-25 10:00:00] 项目讨论 (15 条消息) [id: session-1]\n' +
      '[2026-05-24 14:00:00] Bug 修复 (8 条消息) [id: session-2]',
    )
  })

  it('passes date_from and date_to to list_sessions', async () => {
    provider.listSessions.mockResolvedValue([])

    await SessionSearchTool.call(
      { action: 'list_sessions', date_from: '2026-05-25', date_to: '2026-05-26', limit: 20 },
      toolContext,
    )

    expect(provider.listSessions).toHaveBeenCalledWith({
      dateFrom: '2026-05-25',
      dateTo: '2026-05-26',
      limit: 20,
      offset: undefined,
    })
  })

  it('returns "no sessions" when list_sessions finds nothing', async () => {
    provider.listSessions.mockResolvedValue([])

    const result = await SessionSearchTool.call(
      { action: 'list_sessions' },
      toolContext,
    )

    expect(result.content).toBe('暂无会话记录。')
  })

  it('delegates get_messages action to provider.getMessages', async () => {
    provider.getMessages.mockResolvedValue([
      {
        id: 'msg-1',
        role: 'user',
        content: '你好',
        createdAt: '2026-05-25 10:00:00',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: '你好！有什么可以帮助你的？',
        createdAt: '2026-05-25 10:00:05',
      },
    ])

    const result = await SessionSearchTool.call(
      { action: 'get_messages', session_id: 'session-1', date_from: '2026-05-25', limit: 50 },
      toolContext,
    )

    expect(provider.getMessages).toHaveBeenCalledWith('session-1', {
      dateFrom: '2026-05-25',
      dateTo: undefined,
      limit: 50,
    })
    expect(result.content).toBe(
      '[2026-05-25 10:00:00] user: 你好\n' +
      '---\n' +
      '[2026-05-25 10:00:05] assistant: 你好！有什么可以帮助你的？',
    )
  })

  it('returns "not found" when get_messages finds nothing', async () => {
    provider.getMessages.mockResolvedValue([])

    const result = await SessionSearchTool.call(
      { action: 'get_messages', session_id: 'empty-session' },
      toolContext,
    )

    expect(result.content).toBe('该会话中未找到消息。')
  })

  it('requires session_id for get_messages action', async () => {
    const result = await SessionSearchTool.call(
      { action: 'get_messages' },
      toolContext,
    )

    expect(result.content).toBe('请提供会话 ID（session_id）。')
    expect(provider.getMessages).not.toHaveBeenCalled()
  })

  it('returns error for unknown action', async () => {
    const result = await SessionSearchTool.call(
      { action: 'unknown' as string },
      toolContext,
    )

    expect(result.content).toBe('未知操作：unknown')
  })
})

describe('Tool Registration', () => {
  it('MemoryTool has correct name and is not read-only', () => {
    expect(MemoryTool.name).toBe('Memory')
    expect(MemoryTool.isReadOnly?.()).toBe(false)
    expect(MemoryTool.isConcurrencySafe?.()).toBe(false)
  })

  it('SessionSearchTool has correct name and is read-only', () => {
    expect(SessionSearchTool.name).toBe('SessionSearch')
    expect(SessionSearchTool.isReadOnly?.()).toBe(true)
    expect(SessionSearchTool.isConcurrencySafe?.()).toBe(true)
  })
})
