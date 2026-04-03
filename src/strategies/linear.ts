export function linearDelay(attempt: number, baseDelay: number): number {
  return attempt * baseDelay
}
