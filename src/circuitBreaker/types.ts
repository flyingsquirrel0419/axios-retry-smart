export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitTransition {
  from: CircuitState
  to: CircuitState
  changedAt: number
}

export interface CircuitBreakerSnapshot {
  state: CircuitState
  failureCount: number
  requestCount: number
  lastFailureTime: number | null
  nextAttemptAt: number | null
  updatedAt: number
}

export interface CircuitBreakerRequestDecision {
  allowed: boolean
  state: CircuitState
  isProbeRequest: boolean
  transition?: CircuitTransition
}
