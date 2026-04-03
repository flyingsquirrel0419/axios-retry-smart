import type { CircuitBreakerOptions } from '../types'
import type {
  CircuitBreakerRequestDecision,
  CircuitBreakerSnapshot,
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

  constructor(private options: CircuitBreakerOptions) {}

  updateOptions(options: CircuitBreakerOptions): void {
    this.options = options
  }

  beforeRequest(countRequest = true, now = Date.now()): CircuitBreakerRequestDecision {
    this.updatedAt = now

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

    if (this.state === 'HALF_OPEN') {
      this.halfOpenProbeInFlight = false
      return this.transitionTo('OPEN', now)
    }

    this.failureCount += 1

    if (this.requestCount < this.options.volumeThreshold) {
      return undefined
    }

    if (this.failureCount >= this.options.threshold) {
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

    if (this.state !== 'CLOSED') {
      return this.transitionTo('CLOSED', now)
    }

    return undefined
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      failureCount: this.failureCount,
      requestCount: this.requestCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptAt: this.nextAttemptAt,
      updatedAt: this.updatedAt,
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
    }

    return transition
  }
}
