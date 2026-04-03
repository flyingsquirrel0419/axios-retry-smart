import type { SmartRetryMetrics, SmartRetryMetricsSnapshot } from '../types'

const INITIAL_SNAPSHOT: SmartRetryMetricsSnapshot = {
  requestAttempts: 0,
  retries: 0,
  successes: 0,
  failures: 0,
  shortCircuits: 0,
  circuitOpens: 0,
  circuitCloses: 0,
}

export class SmartRetryMetricsRegistry implements SmartRetryMetrics {
  private snapshotState: SmartRetryMetricsSnapshot = { ...INITIAL_SNAPSHOT }

  recordRequestAttempt(): void {
    this.snapshotState.requestAttempts += 1
  }

  recordRetry(): void {
    this.snapshotState.retries += 1
  }

  recordSuccess(): void {
    this.snapshotState.successes += 1
  }

  recordFailure(): void {
    this.snapshotState.failures += 1
  }

  recordShortCircuit(): void {
    this.snapshotState.shortCircuits += 1
  }

  recordCircuitOpen(): void {
    this.snapshotState.circuitOpens += 1
  }

  recordCircuitClose(): void {
    this.snapshotState.circuitCloses += 1
  }

  snapshot(): SmartRetryMetricsSnapshot {
    return { ...this.snapshotState }
  }

  toPrometheus(): string {
    const snapshot = this.snapshot()
    return [
      '# HELP smart_retry_request_attempts_total Total outbound request attempts.',
      '# TYPE smart_retry_request_attempts_total counter',
      `smart_retry_request_attempts_total ${snapshot.requestAttempts}`,
      '# HELP smart_retry_retries_total Total retries scheduled by the client.',
      '# TYPE smart_retry_retries_total counter',
      `smart_retry_retries_total ${snapshot.retries}`,
      '# HELP smart_retry_successes_total Total successful responses.',
      '# TYPE smart_retry_successes_total counter',
      `smart_retry_successes_total ${snapshot.successes}`,
      '# HELP smart_retry_failures_total Total terminal failures.',
      '# TYPE smart_retry_failures_total counter',
      `smart_retry_failures_total ${snapshot.failures}`,
      '# HELP smart_retry_short_circuits_total Total requests rejected because a circuit was open.',
      '# TYPE smart_retry_short_circuits_total counter',
      `smart_retry_short_circuits_total ${snapshot.shortCircuits}`,
      '# HELP smart_retry_circuit_opens_total Total circuit open transitions.',
      '# TYPE smart_retry_circuit_opens_total counter',
      `smart_retry_circuit_opens_total ${snapshot.circuitOpens}`,
      '# HELP smart_retry_circuit_closes_total Total circuit close transitions.',
      '# TYPE smart_retry_circuit_closes_total counter',
      `smart_retry_circuit_closes_total ${snapshot.circuitCloses}`,
    ].join('\n')
  }
}
