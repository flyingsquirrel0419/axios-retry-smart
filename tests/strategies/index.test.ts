import { describe, expect, it, vi } from 'vitest'

import {
  exponentialDelay,
  exponentialJitterDelay,
  fixedDelay,
  linearDelay,
  resolveRetryDelay,
} from '../../src/strategies'

describe('retry strategies', () => {
  it('returns fixed delay', () => {
    expect(fixedDelay(250)).toBe(250)
  })

  it('returns linear delay', () => {
    expect(linearDelay(3, 200)).toBe(600)
  })

  it('returns exponential delay with max cap', () => {
    expect(exponentialDelay(1, 100, 1_000)).toBe(100)
    expect(exponentialDelay(4, 100, 1_000)).toBe(800)
    expect(exponentialDelay(6, 100, 1_000)).toBe(1_000)
  })

  it('adds jitter on top of exponential delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    expect(exponentialJitterDelay(3, 100, 1_000, 0.4)).toBe(320)
  })

  it('defaults to full jitter when jitterFactor is 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    expect(exponentialJitterDelay(3, 100, 1_000, 1)).toBe(200)
  })

  it('supports custom delay strategies', () => {
    const delay = resolveRetryDelay(
      {
        attempts: 2,
        strategy: 'custom',
        baseDelay: 100,
        maxDelay: 1_000,
        jitterFactor: 0.3,
        retryOn: [500],
        respectRetryAfter: true,
        retryMethods: ['get'],
        retryNetworkErrors: true,
        timeoutRetry: true,
        delayFn: (attempt) => attempt * 123,
      },
      2,
      {} as never,
      {},
    )

    expect(delay).toBe(246)
  })
})
