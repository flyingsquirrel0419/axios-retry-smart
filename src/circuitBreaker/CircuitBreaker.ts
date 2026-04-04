import type { CircuitBreakerOptions } from '../types'
import type {
  CircuitBreakerRequestDecision,
  CircuitBreakerSnapshot,
  CircuitBreakerStateData,
  CircuitBreakerOutcome,
  CircuitState,
  CircuitTransition,
} from './types'

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failureCount = 0
  private requestCount = 0
  private lastFailureTime: number | null = null
  private nextAttemptAt: number | null = null
  private updatedAt = Date.now()
  private halfOpenProbeInFlight = false
  private outcomes: CircuitBreakerOutcome[] = []

  constructor(
    private options: CircuitBreakerOptions,
    state?: CircuitBreakerStateData,
  ) {
    if (state) {
      this.state = state.state
      this.failureCount = state.failureCount
      this.requestCount = state.requestCount
      this.lastFailureTime = state.lastFailureTime
      this.nextAttemptAt = state.nextAttemptAt
      this.updatedAt = state.updatedAt
      this.halfOpenProbeInFlight = state.halfOpenProbeInFlight
      this.outcomes = [...state.outcomes]
    }
  }

  updateOptions(options: CircuitBreakerOptions): void {
    this.options = options
    this.pruneOutcomes(Date.now())
  }

  beforeRequest(countRequest = true, now = Date.now()): CircuitBreakerRequestDecision {
    this.updatedAt = now
    this.pruneOutcomes(now)

    if (this.state === 'OPEN') {
      const canTransition =
        this.nextAttemptAt !== null && now >= this.nextAttemptAt

      if (!canTransition) {
        return {
          allowed: false,
          state: this.state,
          isProbeRequest: false,
        }
      }

      const transition = this.transitionTo('HALF_OPEN', now)
      return this.beforeHalfOpenRequest(countRequest, transition, now)
    }

    if (this.state === 'HALF_OPEN') {
      return this.beforeHalfOpenRequest(countRequest, undefined, now)
    }

    if (countRequest) {
      this.requestCount += 1
    }

    return {
      allowed: true,
      state: this.state,
      isProbeRequest: false,
    }
  }

  recordSuccess(now = Date.now()): CircuitTransition | undefined {
    this.updatedAt = now
    this.recordOutcome(true, now)
    this.failureCount = 0
    this.halfOpenProbeInFlight = false

    if (this.state !== 'CLOSED') {
      return this.transitionTo('CLOSED', now)
    }

    return undefined
  }

  recordFailure(now = Date.now()): CircuitTransition | undefined {
    this.updatedAt = now
    this.lastFailureTime = now
    this.recordOutcome(false, now)

    if (this.state === 'HALF_OPEN') {
      this.halfOpenProbeInFlight = false
      return this.transitionTo('OPEN', now)
    }

    this.failureCount += 1

    if (this.shouldOpen(now)) {
      return this.transitionTo('OPEN', now)
    }

    return undefined
  }

  reset(now = Date.now()): CircuitTransition | undefined {
    this.updatedAt = now
    this.failureCount = 0
    this.requestCount = 0
    this.lastFailureTime = null
    this.nextAttemptAt = null
    this.halfOpenProbeInFlight = false
    this.outcomes = []

    if (this.state !== 'CLOSED') {
      return this.transitionTo('CLOSED', now)
    }

    return undefined
  }

  snapshot(now = Date.now()): CircuitBreakerSnapshot {
    const window = this.getWindowStats(now)

    return {
      state: this.state,
      mode: this.options.mode,
      failureCount: this.failureCount,
      consecutiveFailureCount: this.failureCount,
      requestCount: this.requestCount,
      windowRequestCount: window.requestCount,
      windowFailureCount: window.failureCount,
      failureRate: window.failureRate,
      lastFailureTime: this.lastFailureTime,
      nextAttemptAt: this.nextAttemptAt,
      updatedAt: this.updatedAt,
    }
  }

  serialize(now = Date.now()): CircuitBreakerStateData {
    this.pruneOutcomes(now)

    return {
      state: this.state,
      failureCount: this.failureCount,
      requestCount: this.requestCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptAt: this.nextAttemptAt,
      updatedAt: this.updatedAt,
      halfOpenProbeInFlight: this.halfOpenProbeInFlight,
      outcomes: [...this.outcomes],
    }
  }

  private beforeHalfOpenRequest(
    countRequest: boolean,
    transition: CircuitTransition | undefined,
    now: number,
  ): CircuitBreakerRequestDecision {
    this.updatedAt = now

    if (this.halfOpenProbeInFlight) {
      return {
        allowed: false,
        state: this.state,
        isProbeRequest: false,
        transition,
      }
    }

    this.halfOpenProbeInFlight = true
    if (countRequest) {
      this.requestCount += 1
    }

    return {
      allowed: true,
      state: this.state,
      isProbeRequest: true,
      transition,
    }
  }

  private transitionTo(nextState: CircuitState, now: number): CircuitTransition {
    const transition = {
      from: this.state,
      to: nextState,
      changedAt: now,
    } satisfies CircuitTransition

    this.state = nextState
    this.updatedAt = now

    if (nextState === 'OPEN') {
      this.nextAttemptAt = now + this.options.timeout
      this.halfOpenProbeInFlight = false
    }

    if (nextState === 'HALF_OPEN') {
      this.nextAttemptAt = null
    }

    if (nextState === 'CLOSED') {
      this.nextAttemptAt = null
      this.halfOpenProbeInFlight = false
      this.requestCount = 0
      this.failureCount = 0
      this.outcomes = []
    }

    return transition
  }

  private shouldOpen(now: number): boolean {
    if (this.options.mode === 'error-rate') {
      const window = this.getWindowStats(now)
      if (window.requestCount < this.options.volumeThreshold) {
        return false
      }

      return (
        window.failureRate !== null &&
        window.failureRate >= this.options.errorRateThreshold
      )
    }

    if (this.requestCount < this.options.volumeThreshold) {
      return false
    }

    return this.failureCount >= this.options.threshold
  }

  private recordOutcome(success: boolean, now: number): void {
    this.outcomes.push({ timestamp: now, success })
    this.pruneOutcomes(now)
  }

  private pruneOutcomes(now: number): void {
    const windowStart = now - this.options.rollingWindowMs
    this.outcomes = this.outcomes.filter((entry) => entry.timestamp >= windowStart)
  }

  private getWindowStats(now: number): {
    requestCount: number
    failureCount: number
    failureRate: number | null
  } {
    this.pruneOutcomes(now)
    const requestCount = this.outcomes.length
    const failureCount = this.outcomes.reduce((count, entry) => {
      return entry.success ? count : count + 1
    }, 0)

    return {
      requestCount,
      failureCount,
      failureRate: requestCount === 0 ? null : failureCount / requestCount,
    }
  }
}
