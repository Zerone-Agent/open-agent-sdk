import { describe, expect, it } from 'vitest'

import {
  computeNextCronRun,
  cronToHuman,
  parseCronExpression,
} from '../cron.js'
import type { CronFields } from '../types.js'

function mustParse(expr: string): CronFields {
  const fields = parseCronExpression(expr)
  expect(fields).not.toBeNull()
  return fields!
}

function localDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, second)
}

function expectLocalDateParts(
  date: Date | null,
  expected: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
  },
): void {
  expect(date).not.toBeNull()
  expect(date!.getFullYear()).toBe(expected.year)
  expect(date!.getMonth() + 1).toBe(expected.month)
  expect(date!.getDate()).toBe(expected.day)
  expect(date!.getHours()).toBe(expected.hour)
  expect(date!.getMinutes()).toBe(expected.minute)
  expect(date!.getSeconds()).toBe(0)
  expect(date!.getMilliseconds()).toBe(0)
}

describe('parseCronExpression', () => {
  it('parses wildcard step expressions like */5 * * * *', () => {
    const fields = mustParse('*/5 * * * *')

    expect(fields.minute).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    expect(fields.hour).toHaveLength(24)
    expect(fields.dayOfMonth).toHaveLength(31)
    expect(fields.month).toHaveLength(12)
    expect(fields.dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('parses range expressions like 1-5 * * * *', () => {
    const fields = mustParse('1-5 * * * *')

    expect(fields.minute).toEqual([1, 2, 3, 4, 5])
  })

  it('parses list expressions like 1,3,5 * * * *', () => {
    const fields = mustParse('1,3,5 * * * *')

    expect(fields.minute).toEqual([1, 3, 5])
  })

  it('parses single values like 0 * * * *', () => {
    const fields = mustParse('0 * * * *')

    expect(fields.minute).toEqual([0])
    expect(fields.hour).toEqual(Array.from({ length: 24 }, (_, i) => i))
  })

  it('parses stepped ranges like 0-23/2 * * * *', () => {
    const fields = mustParse('0-23/2 * * * *')

    expect(fields.minute).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
  })

  it('returns null for invalid expressions', () => {
    expect(parseCronExpression('60 * * * *')).toBeNull()
    expect(parseCronExpression('* 24 * * *')).toBeNull()
    expect(parseCronExpression('* * 0 * *')).toBeNull()
    expect(parseCronExpression('* * * 13 *')).toBeNull()
    expect(parseCronExpression('* * * * 8')).toBeNull()
    expect(parseCronExpression('*/0 * * * *')).toBeNull()
    expect(parseCronExpression('5-1 * * * *')).toBeNull()
    expect(parseCronExpression('abc * * * *')).toBeNull()
  })

  it('treats dayOfWeek 7 as Sunday 0', () => {
    const fields = mustParse('0 0 * * 7')

    expect(fields.dayOfWeek).toEqual([0])
  })

  it('handles extra whitespace', () => {
    const fields = mustParse('  */15   1,2  *   *  1-5  ')

    expect(fields.minute).toEqual([0, 15, 30, 45])
    expect(fields.hour).toEqual([1, 2])
    expect(fields.dayOfWeek).toEqual([1, 2, 3, 4, 5])
  })

  it('rejects expressions with the wrong field count', () => {
    expect(parseCronExpression('* * * *')).toBeNull()
    expect(parseCronExpression('* * * * * *')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseCronExpression('')).toBeNull()
  })
})

describe('computeNextCronRun', () => {
  it('finds the next minute match for */5 * * * *', () => {
    const next = computeNextCronRun(
      mustParse('*/5 * * * *'),
      localDate(2026, 1, 1, 9, 1, 30),
    )

    expectLocalDateParts(next, {
      year: 2026,
      month: 1,
      day: 1,
      hour: 9,
      minute: 5,
    })
  })

  it('finds the next hour for 0 * * * *', () => {
    const next = computeNextCronRun(
      mustParse('0 * * * *'),
      localDate(2026, 1, 1, 9, 1),
    )

    expectLocalDateParts(next, {
      year: 2026,
      month: 1,
      day: 1,
      hour: 10,
      minute: 0,
    })
  })

  it('finds the next day for 0 9 * * *', () => {
    const next = computeNextCronRun(
      mustParse('0 9 * * *'),
      localDate(2026, 1, 1, 10, 0),
    )

    expectLocalDateParts(next, {
      year: 2026,
      month: 1,
      day: 2,
      hour: 9,
      minute: 0,
    })
  })

  it('finds the next weekday for 0 9 * * 1', () => {
    const next = computeNextCronRun(
      mustParse('0 9 * * 1'),
      localDate(2026, 1, 2, 10, 0),
    )

    expectLocalDateParts(next, {
      year: 2026,
      month: 1,
      day: 5,
      hour: 9,
      minute: 0,
    })
  })

  it('uses AND semantics when both dayOfMonth and dayOfWeek are specified', () => {
    const next = computeNextCronRun(
      mustParse('0 9 15 * 1'),
      localDate(2026, 1, 14, 10, 0),
    )

    // Jan 15 2026 is Thursday; next Monday that is also the 15th is Jun 15 2026
    expectLocalDateParts(next, {
      year: 2026,
      month: 6,
      day: 15,
      hour: 9,
      minute: 0,
    })
  })

  it('returns null when no match exists within 366 days', () => {
    const next = computeNextCronRun(
      mustParse('0 0 31 2 *'),
      localDate(2026, 1, 1, 0, 0),
    )

    expect(next).toBeNull()
  })
})

describe('cronToHuman', () => {
  it('describes */5 * * * * as every 5 minutes', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Every 5 minutes')
  })

  it('describes 0 * * * * as every hour', () => {
    expect(cronToHuman('0 * * * *')).toBe('Every hour')
  })

  it('describes 0 9 * * * as a daily schedule', () => {
    expect(cronToHuman('0 9 * * *')).toMatch(/^Every day at /)
  })

  it('describes 0 9 * * 1-5 as weekdays', () => {
    expect(cronToHuman('0 9 * * 1-5')).toMatch(/^Weekdays at /)
  })

  it('returns the original expression for unrecognized patterns', () => {
    const expr = '5,10 * * * *'

    expect(cronToHuman(expr)).toBe(expr)
  })
})
