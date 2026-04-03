import type { AxiosRequestConfig } from 'axios'

import type { CircuitBreakerSnapshot } from './circuitBreaker/types'

export class CircuitBreakerOpenError extends Error {
  readonly name = 'CircuitBreakerOpenError'
  readonly isCircuitBreakerOpen = true

  constructor(
    public readonly key: string,
    public readonly snapshot: CircuitBreakerSnapshot,
    public readonly config?: AxiosRequestConfig,
  ) {
    super(`Circuit breaker is OPEN for: ${key}`)
  }
}
