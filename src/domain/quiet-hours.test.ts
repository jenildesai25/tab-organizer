import { describe, expect, it } from 'vitest'
import {
  clampHour,
  formatQuietHoursSummary,
  isQuietHour,
  quietHoursStatusLine,
} from './quiet-hours.js'

describe('quiet hours', () => {
  it('clamps hours to 0–23', () => {
    expect(clampHour(-1, 7)).toBe(0)
    expect(clampHour(24, 7)).toBe(23)
    expect(clampHour('9', 7)).toBe(9)
    expect(clampHour('x', 7)).toBe(7)
  })

  it('handles same-day and overnight ranges', () => {
    const noon = new Date('2024-01-01T12:00:00')
    const evening = new Date('2024-01-01T23:30:00')
    const morning = new Date('2024-01-01T06:00:00')
    expect(isQuietHour(noon, 9, 17)).toBe(true)
    expect(isQuietHour(evening, 9, 17)).toBe(false)
    expect(isQuietHour(evening, 23, 7)).toBe(true)
    expect(isQuietHour(morning, 23, 7)).toBe(true)
    expect(isQuietHour(noon, 23, 7)).toBe(false)
  })

  it('treats equal start and end as all-day quiet', () => {
    expect(isQuietHour(new Date('2024-01-01T03:00:00'), 5, 5)).toBe(true)
  })

  it('formats a status line only while quiet', () => {
    expect(formatQuietHoursSummary(23, 7)).toContain('PM')
    expect(
      quietHoursStatusLine({
        enabled: true,
        startHour: 23,
        endHour: 7,
        now: new Date('2024-01-01T23:15:00'),
      }),
    ).toMatch(/paused/i)
    expect(
      quietHoursStatusLine({
        enabled: true,
        startHour: 23,
        endHour: 7,
        now: new Date('2024-01-01T12:00:00'),
      }),
    ).toBeNull()
  })
})
