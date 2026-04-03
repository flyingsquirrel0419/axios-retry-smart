export function parseRetryAfter(value: unknown, now = Date.now()): number | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const trimmed = value.trim()
  const seconds = Number(trimmed)

  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000))
  }

  const timestamp = Date.parse(trimmed)
  if (Number.isNaN(timestamp)) {
    return null
  }

  return Math.max(0, timestamp - now)
}
