import { describe, expect, it } from 'vitest'

import { CircuitBreaker } from '../../src/circuitBreaker/CircuitBreaker'

const DEFAULT_OPTIONS = {
  threshold: 3,
  timeout: 100,
  volumeThreshold: 1,
  ttl: 1_000,
  mode: 'consecutive' as const,
  rollingWindowMs: 1_000,
  errorRateThreshold: 0.5,
}

describe('CircuitBreaker', () => {
  it('opens after threshold failures', () => {
    const breaker = new CircuitBreaker(DEFAULT_OPTIONS)

    breaker.beforeRequest()
    breaker.recordFailure()
    breaker.beforeRequest()
    breaker.recordFailure()
    breaker.beforeRequest()
    const transition = breaker.recordFailure()

    expect(transition?.to).toBe('OPEN')
    expect(breaker.snapshot().state).toBe('OPEN')
  })

  it('moves to half-open after timeout and closes on success', () => {
    const breaker = new CircuitBreaker({
      ...DEFAULT_OPTIONS,
      threshold: 1,
      timeout: 50,
    })

    breaker.beforeRequest(true, 0)
    breaker.recordFailure(0)

    const openSnapshot = breaker.snapshot()
    expect(openSnapshot.state).toBe('OPEN')

    const decision = breaker.beforeRequest(true, 60)
    expect(decision.allowed).toBe(true)
    expect(decision.isProbeRequest).toBe(true)
    expect(decision.transition?.to).toBe('HALF_OPEN')

    const transition = breaker.recordSuccess(60)
    expect(transition?.to).toBe('CLOSED')
    expect(breaker.snapshot().state).toBe('CLOSED')
  })

  it('blocks concurrent half-open probes', () => {
    const breaker = new CircuitBreaker({
      ...DEFAULT_OPTIONS,
      threshold: 1,
      timeout: 50,
    })

    breaker.beforeRequest(true, 0)
    breaker.recordFailure(0)

    const first = breaker.beforeRequest(true, 60)
    const second = breaker.beforeRequest(true, 60)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
  })

  it('opens on rolling-window error rate when configured', () => {
    const breaker = new CircuitBreaker({
      ...DEFAULT_OPTIONS,
      mode: 'error-rate',
      volumeThreshold: 5,
      errorRateThreshold: 0.3,
      rollingWindowMs: 1_000,
    })

    breaker.beforeRequest(true, 0)
    breaker.recordFailure(0)
    breaker.beforeRequest(true, 10)
    breaker.recordSuccess(10)
    breaker.beforeRequest(true, 20)
    breaker.recordSuccess(20)
    breaker.beforeRequest(true, 30)
    breaker.recordFailure(30)
    breaker.beforeRequest(true, 40)
    const transition = breaker.recordFailure(40)

    expect(transition?.to).toBe('OPEN')
    expect(breaker.snapshot(40)).toMatchObject({
      state: 'OPEN',
      mode: 'error-rate',
      windowRequestCount: 5,
      windowFailureCount: 3,
      failureRate: 0.6,
    })
  })
})
