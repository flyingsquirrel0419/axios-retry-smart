import axios, { CanceledError } from 'axios'
import nock from 'nock'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CircuitBreakerOpenError,
  withSmartRetry,
} from '../../src'

describe('withSmartRetry integration', () => {
  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
    vi.restoreAllMocks()
  })

  it('retries transient failures and eventually succeeds', async () => {
    nock('https://api.example.com')
      .get('/data')
      .reply(503, { ok: false })
      .get('/data')
      .reply(503, { ok: false })
      .get('/data')
      .reply(200, { ok: true })

    const retries: number[] = []
    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 3, strategy: 'fixed', baseDelay: 1 },
      hooks: {
        onRetry: (attempt) => retries.push(attempt),
      },
    })

    const response = await client.get('https://api.example.com/data')

    expect(response.data).toEqual({ ok: true })
    expect(retries).toEqual([1, 2])
    expect(client.getMetricsSnapshot()).toMatchObject({
      requestAttempts: 3,
      retries: 2,
      successes: 1,
      failures: 0,
    })
  })

  it('respects per-request retry disable overrides', async () => {
    nock('https://api.example.com').get('/health').reply(503, { ok: false })

    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 3, strategy: 'fixed', baseDelay: 1 },
    })

    await expect(
      client.get('https://api.example.com/health', {
        retryConfig: false,
      }),
    ).rejects.toMatchObject({
      response: { status: 503 },
    })
  })

  it('opens the circuit after repeated terminal failures', async () => {
    nock('https://api.example.com').get('/data').times(3).reply(500, { ok: false })

    const opens: string[] = []
    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      circuitBreaker: { threshold: 3, timeout: 500, volumeThreshold: 1 },
      hooks: {
        onCircuitOpen: (key) => opens.push(key),
      },
    })

    for (let index = 0; index < 3; index += 1) {
      await client.get('https://api.example.com/data').catch(() => undefined)
    }

    await expect(client.get('https://api.example.com/data')).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    )

    expect(opens).toEqual(['https://api.example.com'])
    expect(client.getCircuitBreaker('https://api.example.com')?.state).toBe('OPEN')
    expect(client.getMetricsSnapshot().shortCircuits).toBe(1)
  })

  it('moves from open to half-open and closes again after recovery', async () => {
    nock('https://api.example.com')
      .get('/data')
      .reply(500, { ok: false })
      .get('/data')
      .reply(200, { ok: true })

    const closed: string[] = []
    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      circuitBreaker: { threshold: 1, timeout: 20, volumeThreshold: 1 },
      hooks: {
        onCircuitClose: (key) => closed.push(key),
      },
    })

    await client.get('https://api.example.com/data').catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 25))

    const response = await client.get('https://api.example.com/data')

    expect(response.status).toBe(200)
    expect(client.getCircuitBreaker('https://api.example.com')?.state).toBe('CLOSED')
    expect(closed).toEqual(['https://api.example.com'])
  })

  it('applies per-request circuit breaker overrides to an existing endpoint', async () => {
    nock('https://api.example.com').get('/override').reply(500, { ok: false })

    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      circuitBreaker: { threshold: 5, timeout: 1_000, volumeThreshold: 1 },
    })

    await client
      .get('https://api.example.com/override', {
        circuitBreakerConfig: {
          threshold: 1,
        },
      })
      .catch(() => undefined)

    await expect(
      client.get('https://api.example.com/override'),
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError)
  })

  it('keeps the default volume threshold at 10 before opening a circuit', async () => {
    nock('https://api.example.com').get('/threshold').times(10).reply(500, { ok: false })

    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      circuitBreaker: { threshold: 1, timeout: 500 },
    })

    for (let index = 0; index < 9; index += 1) {
      await client.get('https://api.example.com/threshold').catch(() => undefined)
    }

    expect(client.getCircuitBreaker('https://api.example.com')?.state).toBe('CLOSED')

    await client.get('https://api.example.com/threshold').catch(() => undefined)

    expect(client.getCircuitBreaker('https://api.example.com')?.state).toBe('OPEN')
  })

  it('uses Retry-After header when present', async () => {
    nock('https://api.example.com')
      .get('/limited')
      .reply(429, { ok: false }, { 'Retry-After': '2' })
      .get('/limited')
      .reply(200, { ok: true })

    const delays: number[] = []
    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 1, strategy: 'fixed', baseDelay: 1 },
      hooks: {
        onRetry: (_attempt, _error, _config, delayMs) => delays.push(delayMs),
      },
    })

    const request = client.get('https://api.example.com/limited')
    await new Promise((resolve) => setTimeout(resolve, 10))
    nock.cleanAll()
    nock('https://api.example.com').get('/limited').reply(200, { ok: true })
    await request

    expect(delays).toEqual([2_000])
  }, 5_000)

  it('does not retry canceled requests', async () => {
    nock('https://api.example.com')
      .get('/abort')
      .delay(50)
      .reply(503, { ok: false })

    const retries: number[] = []
    const controller = new AbortController()
    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 3, strategy: 'fixed', baseDelay: 1 },
      hooks: {
        onRetry: (attempt) => retries.push(attempt),
      },
    })

    const request = client.get('https://api.example.com/abort', {
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 5)

    await expect(request).rejects.toBeInstanceOf(CanceledError)
    expect(retries).toEqual([])
  })

  it('honors shouldRetry callbacks', async () => {
    nock('https://api.example.com')
      .get('/custom-retry')
      .reply(418, { ok: false })
      .get('/custom-retry')
      .reply(200, { ok: true })

    const shouldRetry = vi.fn((error, attempt) => {
      return error.response?.status === 418 && attempt === 1
    })

    const client = withSmartRetry(axios.create(), {
      retry: {
        attempts: 1,
        strategy: 'fixed',
        baseDelay: 1,
        shouldRetry,
      },
    })

    const response = await client.get('https://api.example.com/custom-retry')

    expect(response.status).toBe(200)
    expect(shouldRetry).toHaveBeenCalledTimes(1)
  })

  it('invokes custom delay functions for custom strategies', async () => {
    nock('https://api.example.com')
      .get('/delay-fn')
      .reply(500, { ok: false })
      .get('/delay-fn')
      .reply(200, { ok: true })

    const delayFn = vi.fn(() => 1)
    const client = withSmartRetry(axios.create(), {
      retry: {
        attempts: 1,
        strategy: 'custom',
        baseDelay: 1,
        delayFn,
      },
    })

    await client.get('https://api.example.com/delay-fn')

    expect(delayFn).toHaveBeenCalledTimes(1)
    expect(delayFn).toHaveBeenCalledWith(1, expect.anything(), expect.anything())
  })

  it('fires onGiveUp when retries are exhausted', async () => {
    nock('https://api.example.com').get('/give-up').reply(500, { ok: false })

    const onGiveUp = vi.fn()
    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      hooks: {
        onGiveUp,
      },
    })

    await expect(client.get('https://api.example.com/give-up')).rejects.toMatchObject({
      response: { status: 500 },
    })

    expect(onGiveUp).toHaveBeenCalledTimes(1)
    expect(onGiveUp.mock.calls[0]?.[2]).toBe(0)
  })

  it('allows only one half-open probe request at a time', async () => {
    nock('https://api.example.com')
      .get('/probe')
      .reply(500, { ok: false })
      .get('/probe')
      .delay(50)
      .reply(200, { ok: true })

    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      circuitBreaker: { threshold: 1, timeout: 20, volumeThreshold: 1 },
    })

    await client.get('https://api.example.com/probe').catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 25))

    const [first, second] = await Promise.allSettled([
      client.get('https://api.example.com/probe'),
      client.get('https://api.example.com/probe'),
    ])

    expect(first.status).toBe('fulfilled')
    expect(second.status).toBe('rejected')
    expect(second.status === 'rejected' && second.reason).toBeInstanceOf(
      CircuitBreakerOpenError,
    )
  })

  it('supports per-request circuit key resolvers', async () => {
    nock('https://api.example.com')
      .get('/slow')
      .reply(500, { ok: false })
      .get('/health')
      .reply(200, { ok: true })

    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      circuitBreaker: { threshold: 1, timeout: 500, volumeThreshold: 1 },
    })

    await client
      .get('https://api.example.com/slow', {
        circuitKeyResolver: (config) => {
          const url = new URL(config.url!)
          return `${url.origin}${url.pathname}`
        },
      })
      .catch(() => undefined)

    const response = await client
      .get('https://api.example.com/health', {
        circuitKeyResolver: (config) => {
          const url = new URL(config.url!)
          return `${url.origin}${url.pathname}`
        },
      })

    expect(response.status).toBe(200)
    expect(client.getCircuitBreaker('https://api.example.com/slow')?.state).toBe('OPEN')
    expect(client.getCircuitBreaker('https://api.example.com/health')?.state).toBe(
      'CLOSED',
    )
  })

  it('does not create or update a breaker for successful requests with circuitBreakerConfig false', async () => {
    nock('https://api.example.com').get('/no-breaker').reply(200, { ok: true })

    const client = withSmartRetry(axios.create(), {
      retry: { attempts: 0, strategy: 'fixed', baseDelay: 1 },
      circuitBreaker: { threshold: 1, timeout: 500, volumeThreshold: 1 },
    })

    const response = await client.get('https://api.example.com/no-breaker', {
      circuitBreakerConfig: false,
    })

    expect(response.status).toBe(200)
    expect(client.getCircuitBreaker('https://api.example.com')).toBeUndefined()
  })
})
