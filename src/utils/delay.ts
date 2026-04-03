import type { GenericAbortSignal } from 'axios'
import { CanceledError } from 'axios'

interface AbortSignalLike extends GenericAbortSignal {
  addEventListener?: (
    type: 'abort',
    listener: () => void,
    options?: AddEventListenerOptions,
  ) => void
  removeEventListener?: (type: 'abort', listener: () => void) => void
}

export async function sleep(ms: number, signal?: AbortSignalLike): Promise<void> {
  if (ms <= 0) {
    return
  }

  if (signal?.aborted) {
    throw new CanceledError('Request aborted before retry delay elapsed')
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new CanceledError('Request aborted during retry delay'))
    }

    const cleanup = () => {
      signal?.removeEventListener?.('abort', onAbort)
    }

    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}
