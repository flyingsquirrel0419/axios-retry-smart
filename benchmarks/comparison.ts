import { performance } from 'node:perf_hooks'

import axios from 'axios'
import nock from 'nock'

import { withSmartRetry } from '../src'

async function measure(label: string, run: () => Promise<void>): Promise<void> {
  const startedAt = performance.now()
  await run()
  const elapsed = performance.now() - startedAt
  console.log(`${label}: ${elapsed.toFixed(2)}ms`)
}

async function main(): Promise<void> {
  nock.disableNetConnect()

  const totalRequests = 100
  const failUntil = 50

  nock('https://bench.example.com')
    .persist()
    .get('/data')
    .reply(function reply() {
      const requestIndex = Number(this.req.headers['x-request-id'] ?? 0)
      return requestIndex <= failUntil ? [503, { ok: false }] : [200, { ok: true }]
    })

  const smartClient = withSmartRetry(axios.create(), {
    retry: {
      attempts: 2,
      strategy: 'exponential-jitter',
      baseDelay: 5,
    },
  })

  await measure('axios-retry-smart', async () => {
    await Promise.all(
      Array.from({ length: totalRequests }, (_, index) =>
        smartClient
          .get('https://bench.example.com/data', {
            headers: {
              'x-request-id': String(index + 1),
            },
          })
          .catch(() => undefined),
      ),
    )
  })

  console.log(smartClient.getMetricsSnapshot())
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })
