# axios-retry-smart

Smart Axios retries with exponential backoff, jitter, circuit breaking, and lightweight observability.

## Install

```bash
npm install axios axios-retry-smart
```

## Usage

```ts
import axios from 'axios'
import { withSmartRetry } from 'axios-retry-smart'

const client = withSmartRetry(axios.create({ baseURL: 'https://api.example.com' }), {
  retry: {
    attempts: 3,
    strategy: 'exponential-jitter',
    baseDelay: 1_000,
    maxDelay: 30_000,
    jitterFactor: 1,
    retryOn: [408, 429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    threshold: 5,
    timeout: 30_000,
    volumeThreshold: 10,
  },
  hooks: {
    onRetry: (attempt, error, config, delayMs) => {
      console.log(`[retry ${attempt}] ${config.url} in ${delayMs}ms: ${error.message}`)
    },
  },
})

const response = await client.get('/users/123')
console.log(response.data)
```

## Features

- multiple retry strategies including AWS-style exponential jitter
- origin-scoped circuit breakers by default, customizable with `circuitKeyResolver`
- per-request `retryConfig` and `circuitBreakerConfig` overrides
- `Retry-After` header support
- Prometheus-friendly metrics export
- TypeScript-first public API

## Defaults And Semantics

- default retry methods are `GET`, `HEAD`, `OPTIONS`, `PUT`, and `DELETE`
- `POST` is excluded by default because it is commonly non-idempotent
- `DELETE` stays enabled by default because many HTTP APIs treat it as idempotent, but some applications do not; override `retryMethods` if that is unsafe for your API
- circuit breakers are keyed by request origin by default, so failures on `https://api.example.com/foo` can open the breaker for `https://api.example.com/health`
- use `circuitKeyResolver` globally or per request if you need path-level or custom breaker partitioning
- default circuit breaker options are `threshold: 5`, `timeout: 30000`, `volumeThreshold: 10`, `ttl: 300000`
- default `jitterFactor` is `1`, which means Full Jitter; lower values narrow the delay range toward the computed cap
- the breaker uses consecutive failures since the last successful close/reset, not a sliding statistical window

## Custom Circuit Keys

```ts
const client = withSmartRetry(axios.create(), {
  circuitKeyResolver: (config) => {
    const url = new URL(config.url!, config.baseURL)
    return `${url.origin}${url.pathname}`
  },
})
```

You can also pass `circuitKeyResolver` on an individual request.

## Browser Support

- supported in browser builds because the library uses Axios interceptors plus in-memory breaker state
- breaker state is per page or tab and resets on reload
- shared breaker state across tabs, windows, or service workers is not built in
- if you need shared state, wrap `circuitKeyResolver` and breaker management with your own sync layer

## Positioning

- use this package when you already standardize on Axios and want retry plus circuit breaker ergonomics in one place
- use `axios-retry` when you only need retries
- use `cockatiel` or `opossum` when you need a broader resilience toolkit outside Axios

## Scripts

```bash
npm run lint
npm run test
npm run build
```

## Examples

- [basic example](./examples/basic/index.ts)
- [circuit breaker example](./examples/circuit-breaker/index.ts)
- [custom strategy example](./examples/custom-strategy/index.ts)
