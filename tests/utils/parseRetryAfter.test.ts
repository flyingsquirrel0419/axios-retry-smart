import { describe, expect, it } from 'vitest'

import { parseRetryAfter } from '../../src/utils/parseRetryAfter'

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('2')).toBe(2_000)
  })

  it('parses http dates', () => {
    const now = Date.parse('2026-04-03T00:00:00Z')
    const future = new Date(now + 5_000).toUTCString()

    expect(parseRetryAfter(future, now)).toBe(5_000)
  })

  it('returns null for invalid values', () => {
    expect(parseRetryAfter('wat')).toBeNull()
    expect(parseRetryAfter(undefined)).toBeNull()
  })
})
