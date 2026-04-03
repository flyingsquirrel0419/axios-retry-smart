# axios-retry-smart 프로젝트 플랜

> Axios 전용 재시도, jitter, circuit breaker를 하나의 래퍼로 묶는 경량 복원력 라이브러리

---

## 1. 프로젝트 개요

### 문제 정의

프로덕션 환경에서 HTTP 요청 실패를 단순 재시도만으로 처리하면 다음 문제가 생긴다.

- thundering herd: 같은 시점에 실패한 요청이 같은 시점에 다시 몰린다
- cascade failure: 느린 의존 서비스 하나가 호출 체인 전체를 끌어내린다
- unbounded retry pressure: 복구 불가능한 장애에도 계속 재시도하며 리소스를 낭비한다

기존 `axios-retry`는 재시도 자체에는 강하지만, circuit breaker와 breaker 상태 조회, 커스텀 granularity, Prometheus-friendly 메트릭 같은 운영 기능은 기본 제공하지 않는다.

### 해결책

`axios-retry-smart`는 Axios 인스턴스에 다음 3가지를 함께 부여한다.

1. 지수 백오프와 jitter를 포함한 다중 retry 전략
2. endpoint group 단위로 빠르게 실패시키는 circuit breaker
3. 운영 훅, 메트릭, per-request override

### 타겟 사용자

- 외부 API를 많이 호출하는 Node.js 백엔드
- 마이크로서비스 간 HTTP 통신 안정성을 높이려는 팀
- 범용 resilience 라이브러리보다 Axios 특화 ergonomics를 원하는 사용자

---

## 2. 기술 스펙

### 핵심 의존성

```json
{
  "peerDependencies": {
    "axios": ">=1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.0.0",
    "axios": "^1.8.0",
    "tsup": "^8.0.0",
    "nock": "^14.0.0"
  }
}
```

### 지원 환경

- Node.js >= 18
- Axios >= 1.0.0
- TypeScript >= 5.0
- ESM + CJS 동시 지원
- 브라우저 지원
  - breaker 상태는 메모리 기반이므로 탭/페이지 생명주기에 종속된다
  - 페이지 리로드 시 breaker 상태는 초기화된다
  - 기본 구현은 탭 간 상태 공유를 하지 않는다
  - SharedWorker, BroadcastChannel, storage sync는 기본 범위 밖이다

---

## 3. API 설계

### 기본 사용법

```typescript
import axios from 'axios'
import { withSmartRetry } from 'axios-retry-smart'

const client = withSmartRetry(axios.create({ baseURL: 'https://api.example.com' }), {
  retry: {
    attempts: 3,
    strategy: 'exponential-jitter',
    baseDelay: 1000,
    maxDelay: 30_000,
    retryOn: [408, 429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    threshold: 5,
    timeout: 30_000,
    volumeThreshold: 10,
    ttl: 300_000,
  },
  hooks: {
    onRetry: (attempt, error, config, delayMs) => {
      console.log(`[${config.url}] retry #${attempt} in ${delayMs}ms: ${error.message}`)
    },
    onCircuitOpen: (key) => {
      console.warn(`Circuit opened for: ${key}`)
    },
    onCircuitClose: (key) => {
      console.info(`Circuit recovered for: ${key}`)
    },
  },
})

const response = await client.get('/users/123')
```

### 재시도 전략 상세

```typescript
// fixed
// 1s -> 1s -> 1s
{ strategy: 'fixed', baseDelay: 1000 }

// linear
// 1s -> 2s -> 3s
{ strategy: 'linear', baseDelay: 1000 }

// exponential
// 1s -> 2s -> 4s -> 8s
{ strategy: 'exponential', baseDelay: 1000 }

// exponential-jitter
// jitterFactor = 1 -> Full Jitter
// cap = 1s, 2s, 4s ...
// sleep = random(0, cap)
{ strategy: 'exponential-jitter', baseDelay: 1000, maxDelay: 30_000, jitterFactor: 1 }

// custom
{
  strategy: 'custom',
  delayFn: (attempt, error) => {
    const retryAfter = error.response?.headers['retry-after']
    return retryAfter ? parseInt(retryAfter, 10) * 1000 : attempt * 1000
  }
}
```

`exponential-jitter`는 `jitterFactor = 1`일 때 AWS Full Jitter와 동일하다. 더 작은 값을 주면 지터 구간을 cap 근처로 좁힐 수 있다.

### Circuit Breaker 상태 머신

```text
threshold + volumeThreshold 만족      timeout 경과
CLOSED -----------------------------> OPEN -----------------> HALF_OPEN
  ^                                                        |
  |------------------------- success ----------------------|
                                                           |
  |------------------------- failure --------------------->|
```

```typescript
const breaker = client.getCircuitBreaker('https://api.example.com')
console.log(breaker?.state)
console.log(breaker?.failureCount)
console.log(breaker?.lastFailureTime)
console.log(breaker?.nextAttemptAt)

client.resetCircuitBreaker('https://api.example.com')
```

### Circuit key granularity

기본 breaker key는 request origin이다. 즉 `https://api.example.com/slow`와 `https://api.example.com/health`는 기본적으로 같은 breaker를 공유한다.

더 세밀한 분리가 필요하면 `circuitKeyResolver`를 사용한다.

```typescript
const client = withSmartRetry(axios.create(), {
  circuitKeyResolver: (config) => {
    const url = new URL(config.url!, config.baseURL)
    return `${url.origin}${url.pathname}`
  },
})
```

### 개별 요청 오버라이드

```typescript
await client.get('/health', {
  retryConfig: false,
})

await client.post('/payment', data, {
  retryConfig: {
    attempts: 5,
    retryOn: [500, 502, 503],
    respectRetryAfter: true,
    retryMethods: ['post'],
  },
})

await client.get('/status', {
  circuitKeyResolver: (config) => {
    const url = new URL(config.url!, config.baseURL)
    return `${url.origin}${url.pathname}`
  },
})
```

---

## 4. 프로젝트 구조

```text
axios-retry-smart/
├── src/
│   ├── index.ts
│   ├── withSmartRetry.ts
│   ├── strategies/
│   ├── circuitBreaker/
│   ├── observability/
│   ├── utils/
│   └── types.ts
├── tests/
│   ├── strategies/
│   ├── circuitBreaker/
│   ├── integration/
│   └── utils/
├── examples/
├── benchmarks/
└── docs/
```

---

## 5. 핵심 구현 원칙

### Retry

- retry는 Axios request/response interceptor에서 처리한다
- `Retry-After` 헤더가 있으면 전략 계산보다 우선한다
- 기본 retry method는 `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`
- `POST`는 기본 제외
- `CanceledError`는 재시도하지 않는다

### Circuit Breaker

- `threshold`만으로 즉시 열지 않고 `volumeThreshold`도 함께 만족해야 한다
- `HALF_OPEN`에서는 probe request를 1개만 허용한다
- breaker는 sliding window 대신 "마지막 close/reset 이후의 연속 실패" 모델을 사용한다
- breaker state는 store에 보관하며 `ttl` 기준으로 정리한다
- cleanup은 매 요청 전체 스캔이 아니라 다음 cleanup 시점을 관리하며 수행한다

### Observability

- `onRetry`, `onGiveUp`, `onCircuitOpen`, `onCircuitClose`, `onCircuitStateChange` 제공
- Prometheus-friendly counter export 제공
- debug logger 주입 또는 `DEBUG=axios-retry-smart` 지원

---

## 6. 구현 단계별 로드맵

### Phase 1: 핵심 기능

- [x] Axios 인터셉터 기반 재시도 로직
- [x] 5가지 재시도 전략 구현
- [x] Circuit Breaker 상태 머신 구현
- [x] `Retry-After` 헤더 파싱
- [x] TypeScript 타입 완성
- [x] 단위 테스트

### Phase 2: 안정화

- [x] `nock` 기반 통합 테스트
- [x] 취소 요청 처리
- [x] 메모리 누수 방지용 breaker TTL cleanup
- [ ] 브라우저 환경 실기 테스트
- [ ] 번들 사이즈 분석

### Phase 3: 관찰 가능성

- [x] Prometheus 메트릭 export
- [x] Circuit Breaker 상태 변경 훅
- [x] debug logging
- [ ] OpenTelemetry 연동
  - 권장 방향: 메인 번들이 아니라 `axios-retry-smart/otel` 같은 별도 서브패키지로 분리

### Phase 4: 커뮤니티

- [ ] README 심화 문서화
- [ ] 경쟁 라이브러리 비교표 공개
- [ ] 간단 벤치마크 결과 게시
- [ ] 블로그 포스트와 예제 확장

---

## 7. 테스트 전략

현재 필수 검증 시나리오:

- 5xx/429 재시도 후 성공
- `Retry-After` 우선 적용
- retry disable override
- `shouldRetry` 커스텀 decision
- `custom` strategy의 `delayFn`
- `CanceledError`는 재시도 안 함
- circuit open/half-open/close 전이
- half-open 동시 probe 차단
- custom circuit key resolver
- breaker TTL cleanup

예시:

```typescript
it('uses Retry-After when present', async () => {
  nock('https://api.example.com')
    .get('/limited')
    .reply(429, {}, { 'Retry-After': '2' })
    .get('/limited')
    .reply(200, { ok: true })

  const client = withSmartRetry(axios.create(), {
    retry: { attempts: 1, strategy: 'fixed', baseDelay: 1 }
  })

  const res = await client.get('https://api.example.com/limited')
  expect(res.data).toEqual({ ok: true })
})
```

---

## 8. 벤치마크 계획

기본 시나리오:

- 100개 동시 요청
- 50%는 일시적 503
- 비교 지표
  - 총 완료 시간
  - 총 재시도 횟수
  - breaker open 횟수
  - 재시도 분산도

주의점:

- 단순 latency 비교만으로는 의미가 약하다
- "서버 부하 60% 감소" 같은 문구는 실제 측정 전에는 쓰지 않는다
- jitter 효과는 retry 분산도와 tail contention 감소로 설명하는 편이 안전하다

---

## 9. 경쟁 분석과 포지셔닝

| 항목 | axios-retry | cockatiel | opossum | axios-retry-smart |
|------|-------------|-----------|---------|-------------------|
| Axios 특화 UX | ✅ | ❌ | ❌ | ✅ |
| Retry 전략 내장 | ✅ | ✅ | ❌ | ✅ |
| Circuit Breaker 내장 | ❌ | ✅ | ✅ | ✅ |
| Request-level override | △ | n/a | n/a | ✅ |
| Prometheus export | ❌ | ❌ | ❌ | ✅ |
| 브라우저 기본 사용성 | ✅ | △ | ❌ | ✅ |

포지셔닝:

- `axios-retry`보다 운영 기능이 많은 Axios 전용 대안
- `cockatiel`이나 `opossum`보다 도입 장벽이 낮은 Axios wrapper
- 범용 resilience toolkit의 대체재라기보다 Axios 사용자를 위한 ergonomic package

---

## 10. 현실적인 성공 지표

| 지표 | 1개월 | 3개월 | 6개월 |
|------|-------|-------|-------|
| GitHub Stars | 25 | 100 | 300 |
| npm 주간 다운로드 | 200 | 1,000 | 5,000 |
| 외부 예제/언급 | 1 | 5 | 15 |

초기 목표는 대형 라이브러리 수준의 다운로드가 아니라 다음을 달성하는 것이다.

- README만 보고 바로 도입 가능한 수준의 API
- Axios 특화 포지셔닝이 명확한 문서
- 테스트와 운영 기능이 갖춰진 안정적인 MVP
