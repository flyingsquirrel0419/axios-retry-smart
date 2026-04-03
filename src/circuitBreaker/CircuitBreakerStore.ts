import { CircuitBreaker } from './CircuitBreaker'
import type { CircuitBreakerSnapshot } from './types'
import type { CircuitBreakerOptions } from '../types'

interface CircuitBreakerEntry {
  breaker: CircuitBreaker
  touchedAt: number
  ttl: number
}

export class CircuitBreakerStore {
  private readonly entries = new Map<string, CircuitBreakerEntry>()
  private nextCleanupAt = 0

  constructor(private readonly options: CircuitBreakerOptions) {}

  getOrCreate(
    key: string,
    options: CircuitBreakerOptions = this.options,
    now = Date.now(),
  ): CircuitBreaker {
    this.cleanup(now)

    const existing = this.entries.get(key)
    if (existing) {
      existing.breaker.updateOptions(options)
      existing.touchedAt = now
      existing.ttl = options.ttl
      this.scheduleNextCleanup(now, options.ttl)
      return existing.breaker
    }

    const breaker = new CircuitBreaker(options)
    this.entries.set(key, { breaker, touchedAt: now, ttl: options.ttl })
    this.scheduleNextCleanup(now, options.ttl)
    return breaker
  }

  getSnapshot(key: string, now = Date.now()): CircuitBreakerSnapshot | undefined {
    this.cleanup(now)
    return this.entries.get(key)?.breaker.snapshot()
  }

  reset(key: string): void {
    this.entries.get(key)?.breaker.reset()
  }

  snapshots(now = Date.now()): Record<string, CircuitBreakerSnapshot> {
    this.cleanup(now)

    return Object.fromEntries(
      Array.from(this.entries.entries()).map(([key, entry]) => [
        key,
        entry.breaker.snapshot(),
      ]),
    )
  }

  private cleanup(now = Date.now()): void {
    if (now < this.nextCleanupAt) {
      return
    }

    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.touchedAt > entry.ttl) {
        this.entries.delete(key)
      }
    }

    this.nextCleanupAt = now + this.resolveCleanupInterval()
  }

  private resolveCleanupInterval(): number {
    if (this.entries.size === 0) {
      return 100
    }

    let minTtl = Number.POSITIVE_INFINITY

    for (const entry of this.entries.values()) {
      minTtl = Math.min(minTtl, entry.ttl)
    }

    return Math.max(10, Math.min(minTtl, 30_000))
  }

  private scheduleNextCleanup(now: number, ttl: number): void {
    const candidate = now + Math.max(10, Math.min(ttl, 30_000))
    this.nextCleanupAt =
      this.nextCleanupAt === 0 ? candidate : Math.min(this.nextCleanupAt, candidate)
  }
}
