# axios-retry-smart

`axios-retry-smart` bundles three practical resilience patterns into one Axios wrapper:

- configurable retry strategies (`fixed`, `linear`, `exponential`, `exponential-jitter`, `custom`)
- path-scoped circuit breakers by default, with optional origin or custom key resolution
- `Retry-After` support, per-request overrides, hooks, Prometheus-style counters, and a `prom-client` sink bridge

The primary entry point is `withSmartRetry(instance, options)`, which returns the same Axios instance with a few extra helpers:

- `getCircuitBreaker(key)`
- `resetCircuitBreaker(key)`
- `getMetricsSnapshot()`
- `exportPrometheusMetrics()`

Circuit breakers are scoped by request path by default. That means `/slow` and `/health` do not share a breaker unless you switch `circuitKeyStrategy` to `origin` or provide your own `circuitKeyResolver`.

Browser support is intentionally simple by default: breaker state is memory-only, per page lifecycle, and resets on reload. If you want same-origin tab sharing, use `StorageBackedCircuitBreakerStore` with `localStorage` or `sessionStorage`.

The breaker can use either consecutive failures or a rolling-window error-rate policy, both gated by `volumeThreshold`.

The package is best treated as an Axios-focused utility rather than a shared resilience control plane. If you need breaker state across processes or instances, inject a custom `circuitBreakerStore` that matches your environment.
