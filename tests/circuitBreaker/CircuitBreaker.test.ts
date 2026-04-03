import { describe, expect, it } from 'vitest'

import { CircuitBreaker } from '../../src/circuitBreaker/CircuitBreaker'

describe('CircuitBreaker', () => {
  it('opens after threshold failures', () => {
    const breaker = new CircuitBreaker({
      threshold: 3,
      timeout: 100,
      volumeThreshold: 1,
      ttl: 1_000,
    })

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
      threshold: 1,
      timeout: 50,
      volumeThreshold: 1,
      ttl: 1_000,
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
      threshold: 1,
      timeout: 50,
      volumeThreshold: 1,
      ttl: 1_000,
    })

    breaker.beforeRequest(true, 0)
    breaker.recordFailure(0)

    const first = breaker.beforeRequest(true, 60)
    const second = breaker.beforeRequest(true, 60)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
  })
})
