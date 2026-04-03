export function exponentialDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
): number {
  return Math.min(baseDelay * 2 ** Math.max(0, attempt - 1), maxDelay)
}
