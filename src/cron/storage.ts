import type { CronTask } from './types.js'

export interface CronStorage {
  load(): Promise<CronTask[]>
  save(tasks: CronTask[]): Promise<void>
  add(task: Omit<CronTask, 'id' | 'createdAt'>): Promise<string>
  remove(ids: string[]): Promise<void>
  markFired(ids: string[], firedAt: number): Promise<void>
}
