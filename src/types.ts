import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'

import type { CircuitBreakerSnapshot, CircuitState } from './circuitBreaker/types'

export type RetryStrategy =
  | 'fixed'
  | 'linear'
  | 'exponential'
  | 'exponential-jitter'
  | 'custom'

export type RetryDelayFunction = (
  attempt: number,
  error: AxiosError,
  config: AxiosRequestConfig,
) => number

export type RetryDecisionFunction = (
  error: AxiosError,
  attempt: number,
  config: AxiosRequestConfig,
) => boolean

export interface RetryOptions {
  attempts: number
  strategy: RetryStrategy
  baseDelay: number
  maxDelay: number
  /**
   * Controls how much of the exponential cap is randomized.
   * `1` means Full Jitter (`0..cap`), lower values narrow the range toward the cap.
   */
  jitterFactor: number
  retryOn: number[]
  delayFn?: RetryDelayFunction
  respectRetryAfter: boolean
  retryMethods: string[]
  retryNetworkErrors: boolean
  timeoutRetry: boolean
  shouldRetry?: RetryDecisionFunction
}

export interface CircuitBreakerOptions {
  threshold: number
  timeout: number
  volumeThreshold: number
  ttl: number
}

export type CircuitBreakerKeyResolver = (
  config: AxiosRequestConfig,
) => string | undefined

export interface SmartRetryMetricsSnapshot {
  requestAttempts: number
  retries: number
  successes: number
  failures: number
  shortCircuits: number
  circuitOpens: number
  circuitCloses: number
}

export interface SmartRetryMetrics {
  snapshot(): SmartRetryMetricsSnapshot
  toPrometheus(): string
}

export interface SmartRetryHooks {
  onRetry?: (
    attempt: number,
    error: AxiosError,
    config: AxiosRequestConfig,
    delayMs: number,
  ) => void
  onCircuitOpen?: (key: string, snapshot: CircuitBreakerSnapshot) => void
  onCircuitClose?: (key: string, snapshot: CircuitBreakerSnapshot) => void
  onCircuitStateChange?: (
    key: string,
    state: CircuitState,
    snapshot: CircuitBreakerSnapshot,
  ) => void
  onGiveUp?: (
    error: AxiosError,
    config: AxiosRequestConfig,
    attemptsUsed: number,
  ) => void
}

export interface SmartRetryOptions {
  retry?: Partial<RetryOptions>
  circuitBreaker?: Partial<CircuitBreakerOptions> | false
  circuitKeyResolver?: CircuitBreakerKeyResolver
  hooks?: SmartRetryHooks
  debug?: boolean | SmartRetryLogger
}

export type SmartRetryLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type SmartRetryLogger = (
  level: SmartRetryLogLevel,
  message: string,
  context?: Record<string, unknown>,
) => void

export interface SmartRetryAxiosInstance extends AxiosInstance {
  getCircuitBreaker: (key: string) => CircuitBreakerSnapshot | undefined
  resetCircuitBreaker: (key: string) => void
  exportPrometheusMetrics: () => string
  getMetricsSnapshot: () => SmartRetryMetricsSnapshot
}

declare module 'axios' {
  interface AxiosRequestConfig {
    retryConfig?: Partial<RetryOptions> | false
    circuitBreakerConfig?: Partial<CircuitBreakerOptions> | false
    circuitKeyResolver?: CircuitBreakerKeyResolver
  }
}
