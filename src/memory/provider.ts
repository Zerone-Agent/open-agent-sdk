export type MemoryTarget = 'memory' | 'user'

export interface MemoryEntry {
  id: string
  target: MemoryTarget
  agentName: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface MemoryStats {
  used: number
  limit: number
  percentage: number
}

export interface MemorySearchResult {
  messageId: string
  content: string
  sessionId: string
  role: string
  createdAt: string
}

export interface SessionInfo {
  id: string
  title: string
  model?: string
  createdAt: string
  messageCount: number
}

export interface MessageInfo {
  id: string
  role: string
  content: string
  createdAt: string
}

export interface MemoryProvider {
  add(agentName: string, target: MemoryTarget, content: string): Promise<{ ok: boolean; message: string }>
  replace(agentName: string, target: MemoryTarget, oldText: string, newText: string): Promise<{ ok: boolean; message: string }>
  remove(agentName: string, target: MemoryTarget, text: string): Promise<{ ok: boolean; message: string }>
  getAll(agentName: string, target: MemoryTarget): Promise<MemoryEntry[]>
  getStats(agentName: string, target: MemoryTarget): Promise<MemoryStats>
  renderSnapshot(agentName: string): Promise<string>
  search(query: string, opts?: { limit?: number; offset?: number; dateFrom?: string; dateTo?: string }): Promise<MemorySearchResult[]>
  listSessions(opts?: { dateFrom?: string; dateTo?: string; limit?: number; offset?: number }): Promise<SessionInfo[]>
  getMessages(sessionId: string, opts?: { dateFrom?: string; dateTo?: string; limit?: number }): Promise<MessageInfo[]>
}
