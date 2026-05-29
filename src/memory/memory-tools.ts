import { defineTool } from '../tools/types.js'
import type { MemoryProvider } from './provider.js'

let provider: MemoryProvider | null = null

export function initMemoryTools(p: MemoryProvider): void {
  provider = p
}

const MEMORY_LIMIT = 22000
const USER_LIMIT = 1375

export const MemoryTool = defineTool({
  name: 'Memory',
  description: `管理跨会话的持久记忆。

记忆目标：
  memory  — Agent 自身笔记：项目约定、环境事实、学到的经验教训。
            上限：${MEMORY_LIMIT} 字符。超过 80% 时请合并条目。
  user    — 用户画像：偏好、沟通风格、期望。
            上限：${USER_LIMIT} 字符。

操作类型：
  add       — 添加条目。添加前必须检查该目标是否已有含义冲突或过时的条目，如有则改用 replace 而非 add。
             XML 快照中：<memory> 标签对应 target:memory，<user_profile> 标签对应 target:user，请根据标签名正确选择 target。
   replace   — 替换条目（当新信息覆盖/更新/推翻已有信息时使用，不要用 add 造成冲突重复）。
               old_text 指定要被替换的旧内容（支持模糊匹配），new_text 指定新内容。
               content 字段在 replace 操作中不生效，请填写 new_text 而非 content。
  remove    — 删除条目。匹配 content 或 old_text。
  consolidate — 合并条目（请通过 remove + add 手动操作）。

变更立即持久化，将在下一次会话的 system prompt 中生效。`,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'replace', 'remove', 'consolidate'] },
      target: { type: 'string', enum: ['memory', 'user'] },
      content: { type: 'string' },
      old_text: { type: 'string' },
      new_text: { type: 'string' },
    },
    required: ['action'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  async call(input, context) {
    if (!provider) return '记忆系统尚未初始化。'
    const { agentId } = context

    switch (input.action) {
      case 'add':
        return (await provider.add(agentId, input.target, input.content)).message

      case 'replace': {
        const newText = input.new_text ?? input.content ?? ''
        return (await provider.replace(agentId, input.target, input.old_text, newText)).message
      }

      case 'remove':
        return (await provider.remove(agentId, input.target, input.old_text || input.content)).message

      case 'consolidate':
        return '请通过 remove + add 的方式合并相关条目。'

      default:
        return `未知操作：${input.action}`
    }
  },
})

export const SessionSearchTool = defineTool({
  name: 'SessionSearch',
  description: `搜索或浏览历史会话记录。
操作类型：
  search        — 全文搜索消息（BM25 相关性排序），需提供 query。
  list_sessions — 列出最近的会话，按时间倒序。支持 date_from/date_to 按日期范围过滤（格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）。
  get_messages  — 获取指定会话的消息，可按日期范围过滤。`,
  inputSchema: {
    type: 'object',
    properties: {
      action:     { type: 'string', enum: ['search', 'list_sessions', 'get_messages'] },
      query:      { type: 'string' },
      session_id: { type: 'string' },
      date_from:  { type: 'string' },
      date_to:    { type: 'string' },
      limit:      { type: 'number', default: 10 },
      offset:     { type: 'number', default: 0 },
    },
    required: ['action'],
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  async call(input, _context) {
    if (!provider) return '会话搜索不可用。'

    switch (input.action) {
      case 'search': {
        if (!input.query || typeof input.query !== 'string' || !input.query.trim()) {
          return '请提供搜索关键词。'
        }
        const results = await provider.search(input.query, { limit: input.limit, offset: input.offset, dateFrom: input.date_from, dateTo: input.date_to })
        if (results.length === 0) return '未找到匹配的消息。'
        return results
          .map(r => `[${r.createdAt}] ${r.role}: ${r.content}`)
          .join('\n---\n')
      }

      case 'list_sessions': {
        const sessions = await provider.listSessions({
          dateFrom: input.date_from,
          dateTo: input.date_to,
          limit: input.limit,
          offset: input.offset,
        })
        if (sessions.length === 0) return '暂无会话记录。'
        return sessions
          .map(s => `[${s.createdAt}] ${s.title || '(无标题)'} (${s.messageCount} 条消息) [id: ${s.id}]`)
          .join('\n')
      }

      case 'get_messages': {
        if (!input.session_id) return '请提供会话 ID（session_id）。'
        const messages = await provider.getMessages(input.session_id, {
          dateFrom: input.date_from,
          dateTo: input.date_to,
          limit: input.limit,
        })
        if (messages.length === 0) return '该会话中未找到消息。'
        return messages
          .map(m => `[${m.createdAt}] ${m.role}: ${m.content}`)
          .join('\n---\n')
      }

      default:
        return `未知操作：${input.action}`
    }
  },
})
