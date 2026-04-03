import axios from 'axios'

import { withSmartRetry } from '../../src'

async function main(): Promise<void> {
  const client = withSmartRetry(axios.create(), {
    retry: {
      attempts: 1,
      strategy: 'fixed',
      baseDelay: 100,
    },
    circuitBreaker: {
      threshold: 3,
      timeout: 10_000,
      volumeThreshold: 1,
    },
    hooks: {
      onCircuitOpen: (key) => console.warn(`circuit opened: ${key}`),
      onCircuitClose: (key) => console.info(`circuit closed: ${key}`),
    },
  })

  for (let index = 0; index < 5; index += 1) {
    try {
      await client.get('https://api.example.com/flaky')
    } catch (error) {
      console.error(`request ${index + 1} failed`, error)
    }
  }

  console.log(client.getCircuitBreaker('https://api.example.com'))
  console.log(client.exportPrometheusMetrics())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
