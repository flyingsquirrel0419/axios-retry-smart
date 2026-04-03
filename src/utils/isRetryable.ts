import type { AxiosError, AxiosRequestConfig } from 'axios'
import { CanceledError } from 'axios'

import type { RetryOptions } from '../types'

function normalizeMethod(method?: string): string {
  return (method ?? 'get').toLowerCase()
}

export function isMethodRetryable(
  config: AxiosRequestConfig,
  retryMethods: string[],
): boolean {
  return retryMethods.includes(normalizeMethod(config.method))
}

export function isTimeoutError(error: AxiosError): boolean {
  return error.code === 'ECONNABORTED'
}

export function isNetworkError(error: AxiosError): boolean {
  return !error.response && !isTimeoutError(error) && !(error instanceof CanceledError)
}

export function isRetryableError(
  error: AxiosError,
  options: RetryOptions,
  attempt: number,
  config: AxiosRequestConfig,
): boolean {
  if (error instanceof CanceledError) {
    return false
  }

  if (!isMethodRetryable(config, options.retryMethods)) {
    return false
  }

  if (options.shouldRetry) {
    return options.shouldRetry(error, attempt, config)
  }

  if (isTimeoutError(error)) {
    return options.timeoutRetry
  }

  if (isNetworkError(error)) {
    return options.retryNetworkErrors
  }

  const status = error.response?.status
  if (typeof status === 'number') {
    return options.retryOn.includes(status)
  }

  return false
}

export function isCircuitBreakerRelevantError(
  error: AxiosError,
  options: RetryOptions,
): boolean {
  if (error instanceof CanceledError) {
    return false
  }

  if (isTimeoutError(error) || isNetworkError(error)) {
    return true
  }

  const status = error.response?.status
  if (typeof status !== 'number') {
    return false
  }

  return status >= 500 || options.retryOn.includes(status)
}
