import type { SmartRetryMetricName, SmartRetryMetricsSink } from '../types'
import { SMART_RETRY_PROMETHEUS_METRICS } from './SmartRetryMetrics'

interface PromClientCounterLike {
  inc(value?: number): void
}

interface PromClientRegistryLike {
  registerMetric(metric: unknown): void
}

interface PromClientCounterConstructor {
  new (config: {
    name: string
    help: string
    registers?: PromClientRegistryLike[]
  }): PromClientCounterLike
}

export interface PromClientLike {
  Counter: PromClientCounterConstructor
}

export interface PromClientMetricsSinkOptions {
  prefix?: string
  registry?: PromClientRegistryLike
}

export function createPromClientMetricsSink(
  promClient: PromClientLike,
  options: PromClientMetricsSinkOptions = {},
): SmartRetryMetricsSink {
  const { prefix = '', registry } = options

  const counters = Object.fromEntries(
    (Object.keys(SMART_RETRY_PROMETHEUS_METRICS) as SmartRetryMetricName[]).map(
      (metricName) => {
        const metric = SMART_RETRY_PROMETHEUS_METRICS[metricName]
        const counter = new promClient.Counter({
          name: `${prefix}${metric.name}`,
          help: metric.help,
          registers: registry ? [registry] : undefined,
        })
        return [metricName, counter]
      },
    ),
  ) as Record<SmartRetryMetricName, PromClientCounterLike>

  return {
    increment(metricName, value = 1) {
      counters[metricName].inc(value)
    },
  }
}
