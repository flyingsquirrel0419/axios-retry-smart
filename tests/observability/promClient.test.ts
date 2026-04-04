import { describe, expect, it } from 'vitest'

import { createPromClientMetricsSink } from '../../src/observability/createPromClientMetricsSink'
import { SmartRetryMetricsRegistry } from '../../src/observability/SmartRetryMetrics'

class FakeCounter {
  readonly name: string
  value = 0

  constructor(config: {
    name: string
    registers?: Array<{ registerMetric(metric: unknown): void }>
  }) {
    this.name = config.name
    for (const registry of config.registers ?? []) {
      registry.registerMetric(this)
    }
  }

  inc(value = 1): void {
    this.value += value
  }
}

class FakeRegistry {
  readonly metrics: unknown[] = []

  registerMetric(metric: unknown): void {
    this.metrics.push(metric)
  }
}

describe('createPromClientMetricsSink', () => {
  it('increments prom-client counters through a metrics sink', () => {
    const registry = new FakeRegistry()
    const sink = createPromClientMetricsSink(
      { Counter: FakeCounter as never },
      { registry, prefix: 'app_' },
    )
    const metrics = new SmartRetryMetricsRegistry([sink])

    metrics.recordRequestAttempt()
    metrics.recordRetry()
    metrics.recordSuccess()

    expect(registry.metrics).toHaveLength(7)
    const counters = registry.metrics as FakeCounter[]
    expect(
      counters.find(
        (metric) => metric.name === 'app_smart_retry_request_attempts_total',
      )?.value,
    ).toBe(1)
    expect(
      counters.find((metric) => metric.name === 'app_smart_retry_retries_total')?.value,
    ).toBe(1)
    expect(
      counters.find((metric) => metric.name === 'app_smart_retry_successes_total')?.value,
    ).toBe(1)
  })
})
