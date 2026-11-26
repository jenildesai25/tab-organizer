/** Default quiet window: 11pm–7am local time. */
export const DEFAULT_QUIET_HOURS_START = 23
export const DEFAULT_QUIET_HOURS_END = 7

export function clampHour(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(23, Math.max(0, Math.round(n)))
}

/**
 * True when local time falls in the quiet window.
 * Overnight ranges (e.g. 23→7) wrap midnight. Equal start/end means all day quiet.
 */
export function isQuietHour(
  now: Date,
  startHour: number,
  endHour: number,
): boolean {
  const start = clampHour(startHour, DEFAULT_QUIET_HOURS_START)
  const end = clampHour(endHour, DEFAULT_QUIET_HOURS_END)
  const hour = now.getHours()
  if (start === end) return true
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

export function formatHourLabel(hour: number): string {
  const h = clampHour(hour, 0)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}:00 ${suffix}`
}

export function formatQuietHoursSummary(startHour: number, endHour: number): string {
  return `${formatHourLabel(startHour)} – ${formatHourLabel(endHour)}`
}

export function quietHoursStatusLine(options: {
  enabled: boolean
  startHour: number
  endHour: number
  now?: Date
}): string | null {
  if (!options.enabled) return null
  const now = options.now ?? new Date()
  if (!isQuietHour(now, options.startHour, options.endHour)) return null
  return `Quiet hours · auto-group paused until ${formatHourLabel(options.endHour)}`
}
