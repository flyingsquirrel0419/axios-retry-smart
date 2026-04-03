import axios from 'axios'

import { withSmartRetry } from '../../src'

async function main(): Promise<void> {
  const client = withSmartRetry(axios.create(), {
    retry: {
      attempts: 4,
      strategy: 'custom',
      baseDelay: 100,
      delayFn: (attempt, error) => {
        const retryAfter = error.response?.headers['retry-after']
        if (typeof retryAfter === 'string') {
          return Number.parseInt(retryAfter, 10) * 1_000
        }

        return attempt * 500
      },
    },
  })

  const response = await client.post(
    'https://api.example.com/payments',
    { amount: 100 },
    {
      retryConfig: {
        retryMethods: ['post'],
      },
    },
  )

  console.log(response.data)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
