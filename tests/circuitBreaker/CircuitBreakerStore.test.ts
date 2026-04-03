import { describe, expect, it } from 'vitest'

import { CircuitBreakerStore } from '../../src/circuitBreaker/CircuitBreakerStore'

describe('CircuitBreakerStore', () => {
  it('expires entries using each breaker ttl', () => {
    const store = new CircuitBreakerStore({
      threshold: 1,
      timeout: 10,
      volumeThreshold: 1,
      ttl: 100,
    })

    store.getOrCreate(
      'short',
      {
        threshold: 1,
        timeout: 10,
        volumeThreshold: 1,
        ttl: 10,
      },
      0,
    )
    store.getOrCreate(
      'long',
      {
        threshold: 1,
        timeout: 10,
        volumeThreshold: 1,
        ttl: 100,
      },
      0,
    )

    expect(store.getSnapshot('short', 11)).toBeUndefined()
    expect(store.getSnapshot('long', 11)).toBeDefined()
  })
})
