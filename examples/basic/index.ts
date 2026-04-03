import axios from 'axios'

import { withSmartRetry } from '../../src'

async function main(): Promise<void> {
  const client = withSmartRetry(
    axios.create({
      baseURL: 'https://api.example.com',
      timeout: 5_000,
    }),
    {
      retry: {
        attempts: 3,
        strategy: 'exponential-jitter',
        baseDelay: 250,
      },
      hooks: {
        onRetry: (attempt, error, config, delayMs) => {
          console.log(
            `[retry ${attempt}] ${config.method?.toUpperCase()} ${config.url} after ${delayMs}ms (${error.message})`,
          )
        },
      },
    },
  )

  const response = await client.get('/users/123')
  console.log(response.data)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
