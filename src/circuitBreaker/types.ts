export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'
export type CircuitBreakerMode = 'consecutive' | 'error-rate'

export interface CircuitBreakerOutcome {
  timestamp: number
  success: boolean
}

export interface CircuitTransition {
  from: CircuitState
  to: CircuitState
  changedAt: number
}

export interface CircuitBreakerSnapshot {
  state: CircuitState
  mode: CircuitBreakerMode
  failureCount: number
  consecutiveFailureCount: number
  requestCount: number
  windowRequestCount: number
  windowFailureCount: number
  failureRate: number | null
  lastFailureTime: number | null
  nextAttemptAt: number | null
  updatedAt: number
}

export interface CircuitBreakerStateData {
  state: CircuitState
  failureCount: number
  requestCount: number
  lastFailureTime: number | null
  nextAttemptAt: number | null
  updatedAt: number
  halfOpenProbeInFlight: boolean
  outcomes: CircuitBreakerOutcome[]
}

export interface CircuitBreakerRequestDecision {
  allowed: boolean
  state: CircuitState
  isProbeRequest: boolean
  transition?: CircuitTransition
}
