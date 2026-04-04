import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { isAxiosError } from 'axios'

import { CircuitBreakerStore } from './circuitBreaker/CircuitBreakerStore'
import type { CircuitTransition } from './circuitBreaker/types'
import { CircuitBreakerOpenError } from './errors'
import { SmartRetryMetricsRegistry } from './observability/SmartRetryMetrics'
import { resolveRetryDelay } from './strategies'
import type {
  CircuitBreakerOptions,
  CircuitBreakerKeyResolver,
  CircuitKeyStrategy,
  RetryOptions,
  SmartRetryAxiosInstance,
  SmartRetryLogLevel,
  SmartRetryLogger,
  SmartRetryOptions,
} from './types'
import { sleep } from './utils/delay'
import {
  isCircuitBreakerRelevantError,
  isRetryableError,
} from './utils/isRetryable'
import { parseRetryAfter } from './utils/parseRetryAfter'

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  attempts: 3,
  strategy: 'exponential-jitter',
  baseDelay: 1_000,
  maxDelay: 30_000,
  jitterFactor: 1,
  retryOn: [408, 429, 500, 502, 503, 504],
  respectRetryAfter: true,
  retryMethods: ['get', 'head', 'options', 'put', 'delete'],
  retryNetworkErrors: true,
  timeoutRetry: true,
}

const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = {
  threshold: 5,
  timeout: 30_000,
  volumeThreshold: 10,
  ttl: 5 * 60_000,
  mode: 'consecutive',
  rollingWindowMs: 60_000,
  errorRateThreshold: 0.5,
}

const DEBUG_PATTERN = 'axios-retry-smart'
const SMART_RETRY_META_KEY = '__axiosRetrySmartMeta'

interface SmartRetryMeta {
  requestId: number
  retryCount: number
  circuitKey?: string
  isHalfOpenProbe?: boolean
  resolvedRetryOptions?: RetryOptions
  resolvedCircuitBreakerOptions?: CircuitBreakerOptions | false
}

type InternalAxiosRequestConfig = AxiosRequestConfig & {
  [SMART_RETRY_META_KEY]?: SmartRetryMeta
}

export function withSmartRetry(
  instance: AxiosInstance,
  options: SmartRetryOptions = {},
): SmartRetryAxiosInstance {
  const retryDefaults = resolveRetryOptions(options.retry)
  const circuitDefaults = resolveCircuitBreakerOptions(options.circuitBreaker)
  const store =
    options.circuitBreakerStore ??
    (circuitDefaults ? new CircuitBreakerStore(circuitDefaults) : undefined)
  const metrics = new SmartRetryMetricsRegistry(options.metrics?.sinks ?? [])
  const logger = createLogger(options.debug)
  let requestSequence = 0

  instance.interceptors.request.use((config) => {
    const meta = initializeMeta(config, () => ++requestSequence)
    const retryOptions = resolveRetryOptions(config.retryConfig, retryDefaults)
    const circuitOptions = resolveCircuitBreakerOptions(
      config.circuitBreakerConfig,
      circuitDefaults,
    )

    meta.resolvedRetryOptions = retryOptions
    meta.resolvedCircuitBreakerOptions = circuitOptions
    meta.isHalfOpenProbe = false
    meta.circuitKey = circuitOptions
      ? resolveCircuitKey(
          config,
          options.circuitKeyResolver,
          config.circuitKeyStrategy ?? options.circuitKeyStrategy ?? 'path',
        )
      : undefined
    setMeta(config, meta)

    if (store && circuitOptions && meta.circuitKey) {
      const breaker = store.getOrCreate(meta.circuitKey, circuitOptions)
      const decision = breaker.beforeRequest(meta.retryCount === 0)

      emitCircuitTransition(meta.circuitKey, decision.transition, breaker.snapshot())

      if (!decision.allowed) {
        metrics.recordShortCircuit()
        log(
          logger,
          'warn',
          'request short-circuited because the breaker is open',
          config,
          meta,
        )
        throw new CircuitBreakerOpenError(
          meta.circuitKey,
          breaker.snapshot(),
          config,
        )
      }

      meta.isHalfOpenProbe = decision.isProbeRequest
    }

    metrics.recordRequestAttempt()
    log(logger, 'debug', 'dispatching request', config, meta)

    return config
  })

  instance.interceptors.response.use(
    (response) => {
      handleSuccess(response)
      return response
    },
    async (error: unknown) => {
      if (error instanceof CircuitBreakerOpenError) {
        return Promise.reject(error)
      }

      if (!isAxiosError(error)) {
        return Promise.reject(error)
      }

      return handleError(error)
    },
  )

  const smartInstance = instance as SmartRetryAxiosInstance
  smartInstance.getCircuitBreaker = (key: string) => store?.getSnapshot(key)
  smartInstance.resetCircuitBreaker = (key: string) => {
    store?.reset(key)
  }
  smartInstance.exportPrometheusMetrics = () => metrics.toPrometheus()
  smartInstance.getMetricsSnapshot = () => metrics.snapshot()

  return smartInstance

  function handleSuccess(response: AxiosResponse): void {
    const config = response.config
    const meta = getMeta(config)
    metrics.recordSuccess()

    if (!store || !meta?.circuitKey || meta.resolvedCircuitBreakerOptions === false) {
      return
    }

    const breaker = store.getOrCreate(
      meta.circuitKey,
      meta.resolvedCircuitBreakerOptions || undefined,
    )
    const transition = breaker.recordSuccess()
    emitCircuitTransition(meta.circuitKey, transition, breaker.snapshot())
    log(logger, 'debug', 'request succeeded', config, meta)
  }

  async function handleError(error: AxiosError): Promise<AxiosResponse> {
    const config = error.config
    if (!config) {
      metrics.recordFailure()
      return Promise.reject(error)
    }

    const meta = initializeMeta(config, () => ++requestSequence)
    const retryOptions =
      meta.resolvedRetryOptions ?? resolveRetryOptions(config.retryConfig, retryDefaults)
    const circuitOptions =
      meta.resolvedCircuitBreakerOptions ??
      resolveCircuitBreakerOptions(config.circuitBreakerConfig, circuitDefaults)

    meta.resolvedRetryOptions = retryOptions
    meta.resolvedCircuitBreakerOptions = circuitOptions
    setMeta(config, meta)

    const nextAttempt = meta.retryCount + 1
    const canRetry =
      !meta.isHalfOpenProbe &&
      nextAttempt <= retryOptions.attempts &&
      isRetryableError(error, retryOptions, nextAttempt, config)

    if (canRetry) {
      const delayMs = resolveDelayWithRetryAfter(error, config, retryOptions, nextAttempt)

      options.hooks?.onRetry?.(nextAttempt, error, config, delayMs)
      metrics.recordRetry()
      meta.retryCount = nextAttempt
      setMeta(config, meta)

      log(
        logger,
        'info',
        `retrying request in ${delayMs}ms`,
        config,
        meta,
        { attempt: nextAttempt, code: error.code, status: error.response?.status },
      )

      await sleep(delayMs, config.signal)
      return instance.request(config)
    }

    metrics.recordFailure()

    if (store && circuitOptions && meta.circuitKey && isCircuitBreakerRelevantError(error, retryOptions)) {
      const breaker = store.getOrCreate(meta.circuitKey, circuitOptions)
      const transition = breaker.recordFailure()
      emitCircuitTransition(meta.circuitKey, transition, breaker.snapshot())
    }

    options.hooks?.onGiveUp?.(error, config, meta.retryCount)
    log(logger, 'warn', 'request failed permanently', config, meta, {
      code: error.code,
      status: error.response?.status,
    })

    return Promise.reject(error)
  }

  function emitCircuitTransition(
    key: string,
    transition: CircuitTransition | undefined,
    snapshot: NonNullable<ReturnType<SmartRetryAxiosInstance['getCircuitBreaker']>>,
  ): void {
    if (!transition) {
      return
    }

    options.hooks?.onCircuitStateChange?.(key, transition.to, snapshot)

    if (transition.to === 'OPEN') {
      metrics.recordCircuitOpen()
      options.hooks?.onCircuitOpen?.(key, snapshot)
      log(logger, 'warn', 'circuit opened', undefined, undefined, { key })
    }

    if (transition.to === 'CLOSED') {
      metrics.recordCircuitClose()
      options.hooks?.onCircuitClose?.(key, snapshot)
      log(logger, 'info', 'circuit closed', undefined, undefined, { key })
    }
  }
}

function initializeMeta(
  config: AxiosRequestConfig,
  createRequestId: () => number,
): SmartRetryMeta {
  const existing = getMeta(config)
  if (existing) {
    return existing
  }

  const meta = {
    requestId: createRequestId(),
    retryCount: 0,
  } satisfies SmartRetryMeta
  setMeta(config, meta)
  return meta
}

function resolveRetryOptions(
  override?: Partial<RetryOptions> | false,
  base: RetryOptions = DEFAULT_RETRY_OPTIONS,
): RetryOptions {
  if (override === false) {
    return { ...base, attempts: 0 }
  }

  return {
    ...base,
    ...override,
    retryOn: override?.retryOn ?? base.retryOn,
    retryMethods: override?.retryMethods ?? base.retryMethods,
  }
}

function resolveCircuitBreakerOptions(
  override?: Partial<CircuitBreakerOptions> | false,
  base: CircuitBreakerOptions | false = DEFAULT_CIRCUIT_OPTIONS,
): CircuitBreakerOptions | false {
  if (base === false && override !== false && !override) {
    return false
  }

  if (override === false) {
    return false
  }

  const seed = base === false ? DEFAULT_CIRCUIT_OPTIONS : base
  return {
    ...seed,
    ...override,
  }
}

function resolveDelayWithRetryAfter(
  error: AxiosError,
  config: AxiosRequestConfig,
  options: RetryOptions,
  attempt: number,
): number {
  const retryAfterHeader =
    error.response?.headers?.['retry-after'] ??
    error.response?.headers?.['Retry-After']

  if (options.respectRetryAfter) {
    const retryAfterMs = parseRetryAfter(retryAfterHeader)
    if (retryAfterMs !== null) {
      return retryAfterMs
    }
  }

  return resolveRetryDelay(options, attempt, error, config)
}

function resolveCircuitKey(
  config: AxiosRequestConfig,
  fallbackResolver?: CircuitBreakerKeyResolver,
  strategy: CircuitKeyStrategy = 'path',
): string | undefined {
  const resolver = config.circuitKeyResolver ?? fallbackResolver
  if (resolver) {
    return resolver(config)
  }

  const candidateUrl = config.url
  if (!candidateUrl) {
    return undefined
  }

  try {
    const url = config.baseURL
      ? new URL(candidateUrl, config.baseURL)
      : new URL(candidateUrl)
    return strategy === 'origin' ? url.origin : `${url.origin}${url.pathname}`
  } catch {
    return config.baseURL ? new URL(config.baseURL).origin : candidateUrl
  }
}

function getMeta(config: AxiosRequestConfig): SmartRetryMeta | undefined {
  return (config as InternalAxiosRequestConfig)[SMART_RETRY_META_KEY]
}

function setMeta(config: AxiosRequestConfig, meta: SmartRetryMeta): void {
  ;(config as InternalAxiosRequestConfig)[SMART_RETRY_META_KEY] = meta
}

function createLogger(debug?: boolean | SmartRetryLogger): SmartRetryLogger | undefined {
  if (typeof debug === 'function') {
    return debug
  }

  const envDebug = typeof process !== 'undefined' ? process.env.DEBUG : undefined
  const enabled = debug === true || envDebug?.includes(DEBUG_PATTERN)

  if (!enabled) {
    return undefined
  }

  return (level, message, context) => {
    const prefix = `[axios-retry-smart:${level}] ${message}`
    if (context) {
      console[level === 'debug' ? 'debug' : level](prefix, context)
      return
    }
    console[level === 'debug' ? 'debug' : level](prefix)
  }
}

function log(
  logger: SmartRetryLogger | undefined,
  level: SmartRetryLogLevel,
  message: string,
  config?: AxiosRequestConfig,
  meta?: SmartRetryMeta,
  extra?: Record<string, unknown>,
): void {
  if (!logger) {
    return
  }

  logger(level, message, {
    requestId: meta?.requestId,
    retryCount: meta?.retryCount,
    method: config?.method,
    url: config?.url,
    circuitKey: meta?.circuitKey,
    ...extra,
  })
}
