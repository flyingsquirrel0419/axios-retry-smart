# axios-retry-smart

> Axios retry + circuit breaker wrapper with backoff, jitter, Retry-After support, and Prometheus-style metrics.

[![npm version](https://img.shields.io/npm/v/axios-retry-smart.svg)](https://www.npmjs.com/package/axios-retry-smart)
[![npm downloads](https://img.shields.io/npm/dw/axios-retry-smart.svg)](https://www.npmjs.com/package/axios-retry-smart)
[![bundle size](https://img.shields.io/bundlephobia/minzip/axios-retry-smart)](https://bundlephobia.com/package/axios-retry-smart)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/axios-retry-smart)](./LICENSE)

---

## Why this exists

`axios-retry` handles retries. `opossum` handles circuit breaking. Composing them with Axios yourself means writing glue code, testing glue code, and debugging glue code at 3am.

`axios-retry-smart` combines both in one Axios-first wrapper. It ships AWS-style jitter, a real CLOSED → OPEN → HALF_OPEN state machine, Retry-After support, and metrics export without forcing you to build the integration layer yourself.

---

## Install

```bash
npm install axios-retry-smart
# axios is a peer dependency
npm install axios
```

---

## Quick start

```ts
import axios from 'axios'
import { withSmartRetry } from 'axios-retry-smart'

const client = withSmartRetry(axios.create({ baseURL: 'https://api.example.com' }), {
  retry: {
    attempts: 3,
    strategy: 'exponential-jitter',
    baseDelay: 1_000,
    maxDelay: 30_000,
  },
  circuitBreaker: {
    threshold: 5,      // open after 5 consecutive failures
    timeout: 30_000,   // half-open probe after 30s
    volumeThreshold: 10,
  },
})

// Use exactly like a normal Axios instance
const { data } = await client.get('/users/123')
```

That's it. No middleware. No extra wrappers. Same Axios API you already know.

---

## Current scope

`axios-retry-smart` is a focused HTTP client utility, not a full distributed resilience platform.

- the default store is in-memory and scoped to a single Node process or browser tab, but you can inject a custom `circuitBreakerStore` for shared coordination
- breaker policy can be either consecutive-failure based or rolling-window error-rate based
- the default breaker key is request path, and you can switch back to origin-level grouping or provide a custom resolver
- metrics export includes Prometheus-style text and an optional `prom-client` sink bridge

For side projects, small services, or teams that want one Axios integration point for retry plus circuit breaking, that scope is often enough. For shared breaker state, cross-instance coordination, or stricter production policies, plug in your own store and validate the policy you choose.

---

## What each pattern solves

| Problem | Pattern | How it helps |
|---------|---------|-------------|
| Flaky upstream | **Retry** | Retries transient failures automatically |
| Thundering herd | **Jitter** | Spreads retry load across a time window |
| Cascade failure | **Circuit Breaker** | Fast-fails when a dependency is down |
| Rate limits | **Retry-After** | Waits exactly as long as the server asks |

---

## Retry strategies

```ts
// Fixed — 1s → 1s → 1s
{ strategy: 'fixed', baseDelay: 1_000 }

// Linear — 1s → 2s → 3s
{ strategy: 'linear', baseDelay: 1_000 }

// Exponential — 1s → 2s → 4s → 8s
{ strategy: 'exponential', baseDelay: 1_000, maxDelay: 30_000 }

// Exponential + Jitter (recommended) — AWS Full Jitter by default
// jitterFactor: 1 = [0, cap], 0.3 = [0.7·cap, cap]
{ strategy: 'exponential-jitter', baseDelay: 1_000, maxDelay: 30_000, jitterFactor: 1 }

// Custom — full control, e.g. respect Retry-After header
{
  strategy: 'custom',
  delayFn: (attempt, error) => {
    const retryAfter = error.response?.headers['retry-after']
    return retryAfter ? parseInt(retryAfter) * 1_000 : attempt * 500
  },
}
```

---

## Circuit breaker

The breaker is an explicit state machine: **CLOSED → OPEN → HALF_OPEN → CLOSED**.

```
              threshold failures          timeout elapsed
  CLOSED ──────────────────────→ OPEN ─────────────────→ HALF_OPEN
    ↑                                                          │
    └──────────────── probe succeeds ─────────────────────────┘
                                                               │
    ←──────────────── probe fails ─────────────────── back to OPEN
```

Breakers are scoped by **path** by default (`https://api.example.com/users`). Switch to origin-level grouping or customize the key if your API needs a different boundary:

```ts
const client = withSmartRetry(axios.create(), {
  circuitKeyStrategy: 'origin',
})

const pathIsolatedClient = withSmartRetry(axios.create(), {
  circuitKeyResolver: (config) => {
    const url = new URL(config.url!, config.baseURL)
    return `${url.origin}/tenant/${url.searchParams.get('tenantId') ?? 'default'}`
  },
})
```

Inspect or reset at runtime:

```ts
client.getCircuitBreaker('https://api.example.com/users')
// → { state: 'OPEN', failureCount: 5, nextAttemptAt: 1712345678000, ... }

client.resetCircuitBreaker('https://api.example.com/users')
// manual reset after a deploy
```

### Breaker modes

```ts
// Default: open after consecutive failures once enough volume has been seen
{
  circuitBreaker: {
    mode: 'consecutive',
    threshold: 5,
    volumeThreshold: 10,
  },
}

// Rolling window: open when the failure rate stays above a threshold
{
  circuitBreaker: {
    mode: 'error-rate',
    volumeThreshold: 20,
    errorRateThreshold: 0.3,
    rollingWindowMs: 60_000,
    timeout: 30_000,
  },
}
```

### Shared breaker state

```ts
import axios from 'axios'
import {
  StorageBackedCircuitBreakerStore,
  withSmartRetry,
} from 'axios-retry-smart'

const circuitStore = new StorageBackedCircuitBreakerStore(
  {
    threshold: 5,
    timeout: 30_000,
    volumeThreshold: 10,
    ttl: 300_000,
    mode: 'consecutive',
    rollingWindowMs: 60_000,
    errorRateThreshold: 0.5,
  },
  window.localStorage,
)

const client = withSmartRetry(axios.create(), {
  circuitBreakerStore: circuitStore,
})
```

`StorageBackedCircuitBreakerStore` is useful for same-origin browser tabs via `localStorage` or `sessionStorage`. On the server, inject your own `circuitBreakerStore` if you need process-wide or multi-instance coordination.

---

## Per-request overrides

Retry, circuit breaker, and circuit key behaviour can be overridden on individual requests without touching the global defaults.

```ts
// Disable retry for a health-check that must fail fast
await client.get('/health', {
  retryConfig: false,
})

// Opt POST into retry explicitly (it's excluded by default)
await client.post('/payments', payload, {
  retryConfig: {
    attempts: 2,
    retryMethods: ['post'],
    retryOn: [500, 502, 503],
  },
})

// Tighter circuit breaker for a critical path
await client.get('/checkout', {
  circuitBreakerConfig: { threshold: 2, timeout: 60_000 },
})
```

---

## Observability

### Hooks

```ts
const client = withSmartRetry(axios.create(), {
  hooks: {
    onRetry: (attempt, error, config, delayMs) => {
      logger.warn({ attempt, url: config.url, delayMs }, 'retrying request')
    },
    onCircuitOpen: (key, snapshot) => {
      alerts.fire(`circuit open: ${key}`, snapshot)
    },
    onCircuitClose: (key) => {
      logger.info(`circuit recovered: ${key}`)
    },
    onGiveUp: (error, config, attemptsUsed) => {
      logger.error({ url: config.url, attemptsUsed }, 'request permanently failed')
    },
  },
})
```

### Prometheus metrics

```ts
// Returns ready-to-scrape Prometheus text format
console.log(client.exportPrometheusMetrics())

// # HELP smart_retry_request_attempts_total Total outbound request attempts.
// # TYPE smart_retry_request_attempts_total counter
// smart_retry_request_attempts_total 142
// # HELP smart_retry_retries_total Total retries scheduled by the client.
// smart_retry_retries_total 17
// smart_retry_failures_total 3
// smart_retry_short_circuits_total 58
// smart_retry_circuit_opens_total 2
// ...
```

```ts
// Or as a plain snapshot object
const snap = client.getMetricsSnapshot()
// { requestAttempts, retries, successes, failures, shortCircuits, circuitOpens, circuitCloses }
```

```ts
import axios from 'axios'
import { Counter, Registry } from 'prom-client'
import {
  createPromClientMetricsSink,
  withSmartRetry,
} from 'axios-retry-smart'

const registry = new Registry()
const client = withSmartRetry(axios.create(), {
  metrics: {
    sinks: [createPromClientMetricsSink({ Counter }, { registry, prefix: 'app_' })],
  },
})
```

---

## Full option reference

```ts
withSmartRetry(axiosInstance, {
  retry: {
    attempts: 3,                                // max retry count (default: 3)
    strategy: 'exponential-jitter',             // see Retry strategies above
    baseDelay: 1_000,                           // initial delay in ms
    maxDelay: 30_000,                           // delay cap in ms
    jitterFactor: 1,                            // 0–1; 1 = full jitter, 0 = no jitter
    retryOn: [408, 429, 500, 502, 503, 504],    // HTTP status codes to retry
    retryMethods: ['get', 'head', 'options', 'put', 'delete'],
    retryNetworkErrors: true,                   // retry ECONNRESET, ETIMEDOUT, etc.
    timeoutRetry: true,                         // retry ECONNABORTED (axios timeout)
    respectRetryAfter: true,                    // honour Retry-After header
    shouldRetry: (error, attempt, config) => boolean,  // custom predicate
    delayFn: (attempt, error, config) => number,       // required when strategy: 'custom'
  },

  circuitBreaker: {
    threshold: 5,           // used by consecutive mode
    timeout: 30_000,        // ms before trying a probe request
    volumeThreshold: 10,    // minimum requests before the breaker can open
    ttl: 300_000,           // idle breaker cleanup time in ms
    mode: 'consecutive',    // or 'error-rate'
    rollingWindowMs: 60_000,
    errorRateThreshold: 0.5,
  },

  circuitBreakerStore,                                       // optional shared store implementation
  circuitKeyStrategy: 'path',                                // 'path' (default) or 'origin'
  circuitKeyResolver: (config) => string | undefined,  // custom breaker key

  metrics: {
    sinks: [createPromClientMetricsSink({ Counter }, { registry })],
  },

  hooks: {
    onRetry, onCircuitOpen, onCircuitClose, onCircuitStateChange, onGiveUp,
  },

  debug: true,   // or pass a custom (level, message, context) => void logger
})
```

---

## Defaults and semantics

- `POST` is **not** retried by default — most POST endpoints are non-idempotent. Enable it per-request with `retryMethods: ['post']`.
- `DELETE` **is** retried by default — most REST APIs treat it as idempotent. Override if your API does not.
- Circuit breakers are keyed by **path** by default. Set `circuitKeyStrategy: 'origin'` if you want `/slow` and `/health` to share a breaker.
- `jitterFactor: 1` means Full Jitter `[0, cap)`. Lower values narrow the range toward the cap.
- `mode: 'consecutive'` counts failures since the last successful close or reset.
- `mode: 'error-rate'` evaluates recent outcomes within `rollingWindowMs` and opens when `failureRate >= errorRateThreshold`.

---

## Comparison

| | axios-retry | cockatiel | opossum | **axios-retry-smart** |
|---|:---:|:---:|:---:|:---:|
| Retry | ✅ | ✅ | ❌ | ✅ |
| Exponential backoff | ✅ | ✅ | ❌ | ✅ |
| Jitter | ❌ | ✅ | ❌ | ✅ |
| Circuit breaker | ❌ | ✅ | ✅ | ✅ |
| Retry-After header | ❌ | ❌ | ❌ | ✅ |
| Prometheus-style metrics export | ❌ | ❌ | △ | ✅ |
| Per-request overrides | △ | ❌ | ❌ | ✅ |
| Axios-native (no glue) | ✅ | ❌ | ❌ | ✅ |
| TypeScript-first | △ | ✅ | △ | ✅ |
| Browser support | ✅ | ✅ | ❌ | ✅ |

**When to use something else:**
- Need retries only, no circuit breaking → `axios-retry` is simpler
- Need resilience outside Axios (gRPC, DB, queue) → `cockatiel` or `opossum`

---

## Browser support

Works in browsers. The default breaker store is in-memory, per page lifecycle, and resets on reload. For same-origin tab sharing, use `StorageBackedCircuitBreakerStore` with `localStorage` or `sessionStorage`.

---

## CI/CD

This repository includes two GitHub Actions workflows:

- `Validate` runs `npm ci`, `npm run lint`, `npm run test`, and `npm run build` on push and pull requests
- `Release` reuses `Validate`, then publishes to npm only when `NPM_TOKEN` exists and the current package version is not already published

Both workflows write results to the GitHub Actions job summary. Configure `NPM_TOKEN` in repository secrets before using the release workflow.

---

## Requirements

- Axios ≥ 1.0.0
- TypeScript ≥ 5.0 (optional, fully typed)
- ESM and CJS both supported
- Node.js ≥ 18 for the maintained and tested server runtime
- Browser runtime support is available with the in-memory limitations noted above

---

## Contributing

```bash
git clone https://github.com/flyingsquirrel0419/axios-retry-smart
cd axios-retry-smart
npm install
npm test
```

PRs welcome. Please include a test for any changed behaviour.

---

## License

MIT
