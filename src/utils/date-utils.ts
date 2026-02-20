/**
 * Parse a date string (YYYY-MM-DD or ISO timestamp) into a local Date object
 * without UTC timezone shift. Prevents the off-by-one bug where
 * new Date("2026-01-03") becomes Jan 2 in US timezones.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Format a date string for display (e.g., "Friday, January 3, 2026")
 */
export function formatDateLong(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format a date string short (e.g., "Jan 3, 2026")
 */
export function formatDateShort(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Get today's date as YYYY-MM-DD in local timezone
 */
export function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}