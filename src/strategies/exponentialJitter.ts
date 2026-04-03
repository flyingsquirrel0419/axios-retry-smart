import { exponentialDelay } from './exponential'

export function exponentialJitterDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitterFactor = 1,
): number {
  const ceiling = exponentialDelay(attempt, baseDelay, maxDelay)
  const normalized = Math.max(0, Math.min(jitterFactor, 1))
  const floor = ceiling * (1 - normalized)
  const span = ceiling - floor
  return Math.max(0, Math.floor(floor + Math.random() * span))
}
