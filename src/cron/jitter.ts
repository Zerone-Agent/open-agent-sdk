import { computeNextCronRun, parseCronExpression } from './cron.js'
import type { CronJitterConfig, CronTask } from './types.js'

export const DEFAULT_CRON_JITTER_CONFIG: CronJitterConfig = {
  recurringFrac: 0.1,
  recurringCapMs: 4 * 60 * 1000,
  oneShotMaxMs: 90 * 1000,
  oneShotFloorMs: 0,
  oneShotMinuteMod: 30,
  recurringMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
}

function resolveConfig(
  config?: Partial<CronJitterConfig>,
): CronJitterConfig {
  return { ...DEFAULT_CRON_JITTER_CONFIG, ...config }
}

function nextCronRunMs(cron: string, fromMs: number): number | null {
  const fields = parseCronExpression(cron)
  if (!fields) return null
  const next = computeNextCronRun(fields, new Date(fromMs))
  return next ? next.getTime() : null
}

export function jitterFrac(taskId: string): number {
  const frac = parseInt(taskId.slice(0, 8), 16) / 0x1_0000_0000
  return Number.isFinite(frac) ? frac : 0
}

export function jitteredNextCronRunMs(
  cron: string,
  fromMs: number,
  taskId: string,
  config?: Partial<CronJitterConfig>,
): number | null {
  const cfg = resolveConfig(config)
  const t1 = nextCronRunMs(cron, fromMs)
  if (t1 === null) return null

  const t2 = nextCronRunMs(cron, t1)
  if (t2 === null) return t1

  const jitter = Math.min(
    jitterFrac(taskId) * cfg.recurringFrac * (t2 - t1),
    cfg.recurringCapMs,
  )
  return t1 + jitter
}

export function oneShotJitteredNextCronRunMs(
  cron: string,
  fromMs: number,
  taskId: string,
  config?: Partial<CronJitterConfig>,
): number | null {
  const cfg = resolveConfig(config)
  const t1 = nextCronRunMs(cron, fromMs)
  if (t1 === null) return null

  if (new Date(t1).getMinutes() % cfg.oneShotMinuteMod !== 0) return t1

  const lead =
    cfg.oneShotFloorMs +
    jitterFrac(taskId) * (cfg.oneShotMaxMs - cfg.oneShotFloorMs)
  return Math.max(t1 - lead, fromMs)
}

export function isRecurringTaskAged(
  task: CronTask,
  now: number,
  maxAgeMs = DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs,
): boolean {
  if (maxAgeMs === 0) return false
  return Boolean(
    task.recurring && !task.permanent && now - task.createdAt >= maxAgeMs,
  )
}
