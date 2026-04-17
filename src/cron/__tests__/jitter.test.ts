import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CRON_JITTER_CONFIG,
  isRecurringTaskAged,
  jitteredNextCronRunMs,
  jitterFrac,
  oneShotJitteredNextCronRunMs,
} from '../jitter.js'
import type { CronTask } from '../types.js'

function localTimeMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

function task(overrides: Partial<CronTask> = {}): CronTask {
  return {
    id: 'task-1',
    cron: '*/5 * * * *',
    prompt: 'Run this task',
    createdAt: 1_000,
    recurring: true,
    ...overrides,
  }
}

describe('jitterFrac', () => {
  it('returns values in the [0, 1) range', () => {
    expect(jitterFrac('00000000-task')).toBeGreaterThanOrEqual(0)
    expect(jitterFrac('00000000-task')).toBeLessThan(1)
    expect(jitterFrac('ffffffff-task')).toBeGreaterThanOrEqual(0)
    expect(jitterFrac('ffffffff-task')).toBeLessThan(1)
  })

  it('is deterministic for the same taskId', () => {
    const first = jitterFrac('89abcdef-task')
    const second = jitterFrac('89abcdef-task')

    expect(second).toBe(first)
  })

  it('returns different values for different taskIds', () => {
    expect(jitterFrac('00000000-task')).not.toBe(jitterFrac('80000000-task'))
  })
})

describe('jitteredNextCronRunMs', () => {
  it('returns a timestamp greater than or equal to fromMs', () => {
    const fromMs = localTimeMs(2026, 1, 1, 0, 0)
    const next = jitteredNextCronRunMs('*/5 * * * *', fromMs, '80000000-task')

    expect(next).not.toBeNull()
    expect(next!).toBeGreaterThanOrEqual(fromMs)
  })

  it('is deterministic for the same inputs', () => {
    const fromMs = localTimeMs(2026, 1, 1, 0, 0)
    const first = jitteredNextCronRunMs('*/5 * * * *', fromMs, '80000000-task')
    const second = jitteredNextCronRunMs('*/5 * * * *', fromMs, '80000000-task')

    expect(second).toBe(first)
  })

  it('returns null for invalid cron expressions', () => {
    expect(jitteredNextCronRunMs('invalid cron', Date.now(), 'task-1')).toBeNull()
  })
})

describe('oneShotJitteredNextCronRunMs', () => {
  it('returns null for invalid cron expressions', () => {
    expect(oneShotJitteredNextCronRunMs('invalid cron', Date.now(), 'task-1')).toBeNull()
  })

  it('returns a result greater than or equal to fromMs', () => {
    const fromMs = localTimeMs(2026, 1, 1, 0, 0)
    const next = oneShotJitteredNextCronRunMs('30 * * * *', fromMs, '80000000-task')

    expect(next).not.toBeNull()
    expect(next!).toBeGreaterThanOrEqual(fromMs)
  })
})

describe('isRecurringTaskAged', () => {
  it('returns true when age is greater than or equal to maxAgeMs', () => {
    expect(isRecurringTaskAged(task({ createdAt: 1_000 }), 2_000, 1_000)).toBe(true)
  })

  it('returns false when age is less than maxAgeMs', () => {
    expect(isRecurringTaskAged(task({ createdAt: 1_001 }), 2_000, 1_000)).toBe(false)
  })

  it('returns false for permanent tasks', () => {
    expect(
      isRecurringTaskAged(
        task({ createdAt: 1_000, permanent: true }),
        1_000 + DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs,
      ),
    ).toBe(false)
  })

  it('returns false for non-recurring tasks', () => {
    expect(
      isRecurringTaskAged(
        task({ createdAt: 1_000, recurring: false }),
        1_000 + DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs,
      ),
    ).toBe(false)
  })
})
