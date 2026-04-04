import type {
  SmartRetryMetricName,
  SmartRetryMetrics,
  SmartRetryMetricsSink,
  SmartRetryMetricsSnapshot,
} from '../types'

const INITIAL_SNAPSHOT: SmartRetryMetricsSnapshot = {
  requestAttempts: 0,
  retries: 0,
  successes: 0,
  failures: 0,
  shortCircuits: 0,
  circuitOpens: 0,
  circuitCloses: 0,
}

export const SMART_RETRY_PROMETHEUS_METRICS = {
  requestAttempts: {
    name: 'smart_retry_request_attempts_total',
    help: 'Total outbound request attempts.',
  },
  retries: {
    name: 'smart_retry_retries_total',
    help: 'Total retries scheduled by the client.',
  },
  successes: {
    name: 'smart_retry_successes_total',
    help: 'Total successful responses.',
  },
  failures: {
    name: 'smart_retry_failures_total',
    help: 'Total terminal failures.',
  },
  shortCircuits: {
    name: 'smart_retry_short_circuits_total',
    help: 'Total requests rejected because a circuit was open.',
  },
  circuitOpens: {
    name: 'smart_retry_circuit_opens_total',
    help: 'Total circuit open transitions.',
  },
  circuitCloses: {
    name: 'smart_retry_circuit_closes_total',
    help: 'Total circuit close transitions.',
  },
} satisfies Record<SmartRetryMetricName, { name: string; help: string }>

export class SmartRetryMetricsRegistry implements SmartRetryMetrics {
  private snapshotState: SmartRetryMetricsSnapshot = { ...INITIAL_SNAPSHOT }

  constructor(private readonly sinks: SmartRetryMetricsSink[] = []) {}

  recordRequestAttempt(): void {
    this.increment('requestAttempts')
  }

  recordRetry(): void {
    this.increment('retries')
  }

  recordSuccess(): void {
    this.increment('successes')
  }

  recordFailure(): void {
    this.increment('failures')
  }

  recordShortCircuit(): void {
    this.increment('shortCircuits')
  }

  recordCircuitOpen(): void {
    this.increment('circuitOpens')
  }

  recordCircuitClose(): void {
    this.increment('circuitCloses')
  }

  snapshot(): SmartRetryMetricsSnapshot {
    return { ...this.snapshotState }
  }

  toPrometheus(): string {
    const snapshot = this.snapshot()
    return (Object.keys(SMART_RETRY_PROMETHEUS_METRICS) as SmartRetryMetricName[])
      .flatMap((metricName) => {
        const metric = SMART_RETRY_PROMETHEUS_METRICS[metricName]
        return [
          `# HELP ${metric.name} ${metric.help}`,
          `# TYPE ${metric.name} counter`,
          `${metric.name} ${snapshot[metricName]}`,
        ]
      })
      .join('\n')
  }

  private increment(metricName: SmartRetryMetricName, value = 1): void {
    this.snapshotState[metricName] += value
    for (const sink of this.sinks) {
      sink.increment(metricName, value)
    }
  }
}
