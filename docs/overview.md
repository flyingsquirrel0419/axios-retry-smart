# axios-retry-smart

`axios-retry-smart` bundles three production-oriented resilience patterns into one Axios wrapper:

- configurable retry strategies (`fixed`, `linear`, `exponential`, `exponential-jitter`, `custom`)
- origin-scoped circuit breakers by default, with optional custom key resolution
- `Retry-After` support, per-request overrides, hooks, and Prometheus-style counters

The primary entry point is `withSmartRetry(instance, options)`, which returns the same Axios instance with a few extra helpers:

- `getCircuitBreaker(key)`
- `resetCircuitBreaker(key)`
- `getMetricsSnapshot()`
- `exportPrometheusMetrics()`

Circuit breakers are scoped by request origin by default. That means requests to the same scheme/host/port share one breaker unless you provide `circuitKeyResolver` globally or per request.

Browser support is intentionally simple: breaker state is memory-only, per page lifecycle, and resets on reload.

The breaker uses consecutive failures and a `volumeThreshold`, not a sliding time window.
