# Competitive Analysis

## Positioning

`axios-retry-smart` is not trying to replace every resilience library. It is positioned as:

- an Axios-first wrapper with retry and circuit breaker behavior in one integration point
- a lower-friction option than composing Axios with a generic resilience toolkit
- a practical MVP for teams that want operational defaults without building middleware glue first

## Comparison

| Tool | Best at | Trade-off |
|------|---------|-----------|
| `axios-retry` | simple Axios retry | no built-in circuit breaker or metrics export |
| `cockatiel` | broad resilience policies | not Axios-specific, requires more integration code |
| `opossum` | standalone circuit breaker | breaker-focused, retry behavior must be composed separately |
| `axios-retry-smart` | Axios-native retry + breaker + hooks | intentionally narrower than a general resilience framework |

## Messaging

Recommended message:

- "Production-friendly retry and circuit breaker behavior for Axios with minimal glue code."

Avoid overselling:

- do not claim generalized service resilience beyond HTTP client scope
- do not publish benchmark win percentages without measured evidence
