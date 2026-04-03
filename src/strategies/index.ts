import type { AxiosError, AxiosRequestConfig } from 'axios'

import type { RetryOptions } from '../types'
import { fixedDelay } from './fixed'
import { linearDelay } from './linear'
import { exponentialDelay } from './exponential'
import { exponentialJitterDelay } from './exponentialJitter'

export {
  fixedDelay,
  linearDelay,
  exponentialDelay,
  exponentialJitterDelay,
}

export function resolveRetryDelay(
  options: RetryOptions,
  attempt: number,
  error: AxiosError,
  config: AxiosRequestConfig,
): number {
  switch (options.strategy) {
    case 'fixed':
      return fixedDelay(options.baseDelay)
    case 'linear':
      return linearDelay(attempt, options.baseDelay)
    case 'exponential':
      return exponentialDelay(attempt, options.baseDelay, options.maxDelay)
    case 'exponential-jitter':
      return exponentialJitterDelay(
        attempt,
        options.baseDelay,
        options.maxDelay,
        options.jitterFactor,
      )
    case 'custom':
      return Math.max(0, options.delayFn?.(attempt, error, config) ?? 0)
    default:
      return fixedDelay(options.baseDelay)
  }
}
