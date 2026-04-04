import { CircuitBreaker } from './CircuitBreaker'
import type { CircuitBreakerSnapshot, CircuitBreakerStateData } from './types'
import type {
  CircuitBreakerController,
  CircuitBreakerOptions,
  SmartRetryCircuitStore,
} from '../types'

interface StoredCircuitBreakerEntry {
  options: CircuitBreakerOptions
  state: CircuitBreakerStateData
  touchedAt: number
  ttl: number
}

class PersistentCircuitBreaker implements CircuitBreakerController {
  constructor(
    private readonly key: string,
    private readonly store: StorageBackedCircuitBreakerStore,
    private options: CircuitBreakerOptions,
    private readonly nowProvider: () => number,
  ) {}

  updateOptions(options: CircuitBreakerOptions): void {
    this.options = options
    this.store.touch(this.key, options, this.nowProvider())
  }

  beforeRequest(countRequest = true, now = this.nowProvider()) {
    return this.withBreaker(now, (breaker) => breaker.beforeRequest(countRequest, now))
  }

  recordSuccess(now = this.nowProvider()) {
    return this.withBreaker(now, (breaker) => breaker.recordSuccess(now))
  }

  recordFailure(now = this.nowProvider()) {
    return this.withBreaker(now, (breaker) => breaker.recordFailure(now))
  }

  reset(now = this.nowProvider()) {
    return this.withBreaker(now, (breaker) => breaker.reset(now))
  }

  snapshot(now = this.nowProvider()): CircuitBreakerSnapshot {
    return this.withBreaker(now, (breaker) => breaker.snapshot(now))
  }

  private withBreaker<T>(now: number, action: (breaker: CircuitBreaker) => T): T {
    const breaker = this.store.hydrate(this.key, this.options, now)
    const result = action(breaker)
    this.store.persist(this.key, breaker, this.options, now)
    return result
  }
}

export class StorageBackedCircuitBreakerStore implements SmartRetryCircuitStore {
  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly storage: Storage,
    private readonly namespace = 'axios-retry-smart',
  ) {}

  getOrCreate(
    key: string,
    options: CircuitBreakerOptions = this.options,
    now = Date.now(),
  ): CircuitBreakerController {
    this.cleanup(now)
    this.touch(key, options, now)
    return new PersistentCircuitBreaker(key, this, options, () => Date.now())
  }

  getSnapshot(key: string, now = Date.now()): CircuitBreakerSnapshot | undefined {
    this.cleanup(now)
    const entry = this.readEntry(key)
    if (!entry) {
      return undefined
    }

    if (now - entry.touchedAt > entry.ttl) {
      this.deleteEntry(key)
      return undefined
    }

    return new CircuitBreaker(entry.options, entry.state).snapshot(now)
  }

  reset(key: string, now = Date.now()): void {
    const entry = this.readEntry(key)
    if (!entry) {
      return
    }

    const breaker = new CircuitBreaker(entry.options, entry.state)
    breaker.reset(now)
    this.persist(key, breaker, entry.options, now)
  }

  hydrate(key: string, options: CircuitBreakerOptions, now: number): CircuitBreaker {
    this.cleanup(now)
    const entry = this.readEntry(key)

    if (!entry || now - entry.touchedAt > entry.ttl) {
      this.deleteEntry(key)
      return new CircuitBreaker(options)
    }

    return new CircuitBreaker(options, entry.state)
  }

  persist(
    key: string,
    breaker: CircuitBreaker,
    options: CircuitBreakerOptions,
    now: number,
  ): void {
    const entry = {
      options,
      state: breaker.serialize(now),
      touchedAt: now,
      ttl: options.ttl,
    } satisfies StoredCircuitBreakerEntry

    this.storage.setItem(this.storageKey(key), JSON.stringify(entry))
  }

  touch(key: string, options: CircuitBreakerOptions, now: number): void {
    const breaker = this.hydrate(key, options, now)
    this.persist(key, breaker, options, now)
  }

  private cleanup(now: number): void {
    for (let index = 0; index < this.storage.length; index += 1) {
      const storageKey = this.storage.key(index)
      if (!storageKey || !storageKey.startsWith(this.namespacePrefix())) {
        continue
      }

      const raw = this.storage.getItem(storageKey)
      if (!raw) {
        continue
      }

      try {
        const entry = JSON.parse(raw) as StoredCircuitBreakerEntry
        if (now - entry.touchedAt > entry.ttl) {
          this.storage.removeItem(storageKey)
          index -= 1
        }
      } catch {
        this.storage.removeItem(storageKey)
        index -= 1
      }
    }
  }

  private readEntry(key: string): StoredCircuitBreakerEntry | undefined {
    const raw = this.storage.getItem(this.storageKey(key))
    if (!raw) {
      return undefined
    }

    try {
      return JSON.parse(raw) as StoredCircuitBreakerEntry
    } catch {
      this.deleteEntry(key)
      return undefined
    }
  }

  private deleteEntry(key: string): void {
    this.storage.removeItem(this.storageKey(key))
  }

  private storageKey(key: string): string {
    return `${this.namespacePrefix()}${key}`
  }

  private namespacePrefix(): string {
    return `${this.namespace}:`
  }
}
