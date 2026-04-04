import { describe, expect, it } from 'vitest'

import { StorageBackedCircuitBreakerStore } from '../../src/circuitBreaker/StorageBackedCircuitBreakerStore'

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

describe('StorageBackedCircuitBreakerStore', () => {
  it('persists breaker state through shared storage', () => {
    const storage = new MemoryStorage()
    const options = {
      threshold: 1,
      timeout: 100,
      volumeThreshold: 1,
      ttl: 1_000,
      mode: 'consecutive' as const,
      rollingWindowMs: 1_000,
      errorRateThreshold: 0.5,
    }

    const firstStore = new StorageBackedCircuitBreakerStore(options, storage)
    const secondStore = new StorageBackedCircuitBreakerStore(options, storage)

    const firstBreaker = firstStore.getOrCreate('https://api.example.com/slow', options, 0)
    firstBreaker.beforeRequest(true, 0)
    firstBreaker.recordFailure(0)

    expect(
      secondStore.getSnapshot('https://api.example.com/slow', 1)?.state,
    ).toBe('OPEN')
  })
})
