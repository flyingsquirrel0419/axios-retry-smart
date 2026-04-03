# axios-retry-smart

> Production-ready retry + circuit breaker for Axios — exponential backoff, jitter, and Prometheus metrics in one wrapper.

[![npm version](https://img.shields.io/npm/v/axios-retry-smart.svg)](https://www.npmjs.com/package/axios-retry-smart)
[![npm downloads](https://img.shields.io/npm/dw/axios-retry-smart.svg)](https://www.npmjs.com/package/axios-retry-smart)
[![bundle size](https://img.shields.io/bundlephobia/minzip/axios-retry-smart)](https://bundlephobia.com/package/axios-retry-smart)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/axios-retry-smart)](./LICENSE)

---

## Why this exists

`axios-retry` handles retries. `opossum` handles circuit breaking. Composing them with Axios yourself means writing glue code, testing glue code, and debugging glue code at 3am.

`axios-retry-smart` does both — with AWS-style jitter to prevent thundering herd, a real CLOSED → OPEN → HALF_OPEN state machine, Retry-After header support, and built-in Prometheus metrics. Drop it in, get production-grade resilience on day one.

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

Breakers are scoped by **origin** by default (`https://api.example.com`). Customize the key if you need path-level isolation:

```ts
const client = withSmartRetry(axios.create(), {
  // Path-level isolation — /slow and /health don't share a breaker
  circuitKeyResolver: (config) => {
    const url = new URL(config.url!, config.baseURL)
    return `${url.origin}${url.pathname}`
  },
})
```

Inspect or reset at runtime:

```ts
client.getCircuitBreaker('https://api.example.com')
// → { state: 'OPEN', failureCount: 5, nextAttemptAt: 1712345678000, ... }

client.resetCircuitBreaker('https://api.example.com')
// manual reset after a deploy
```

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
    threshold: 5,           // consecutive failures before opening
    timeout: 30_000,        // ms before trying a probe request
    volumeThreshold: 10,    // minimum requests before the breaker can open
    ttl: 300_000,           // idle breaker cleanup time in ms
  },

  circuitKeyResolver: (config) => string | undefined,  // custom breaker key

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
- Circuit breakers are keyed by **origin** by default. Failures on `/slow` can open the breaker for `/health` unless you set `circuitKeyResolver`.
- `jitterFactor: 1` means Full Jitter `[0, cap)`. Lower values narrow the range toward the cap.
- The breaker counts **consecutive failures** since the last successful close or reset — not a sliding window. This is simpler and predictable but means a recovery resets the count.

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

Works in browsers — breaker state is in-memory, per page lifecycle, and resets on reload. There is no built-in cross-tab sync; if you need shared breaker state across tabs, wrap `circuitKeyResolver` with your own coordination layer (SharedWorker, BroadcastChannel).

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
