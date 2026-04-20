/**
 * Recent api.ts 변경에 대한 회귀·엣지 테스트.
 *
 * 커버리지:
 *  - statusFallbackMessage: 상태 코드별 한국어 메시지 매핑
 *  - classifyApiError: 재시도 가능/관리자 문의 필요 여부 분류
 *  - makeIdempotencyKey: 유일성·형식
 *  - createTicket/addComment/bulkUpdateTickets: idempotencyKey 옵션이 헤더로 전파되는가
 */
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost/api'

import {
  classifyApiError,
  makeIdempotencyKey,
  createTicket,
  addComment,
  bulkUpdateTickets,
} from '@/lib/api'

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------
type MockCall = { url: string; init: RequestInit }
const fetchCalls: MockCall[] = []

function mockOk(body: unknown, status = 200) {
  fetchCalls.length = 0
  global.fetch = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  })
}

function mockError(status: number, body: unknown = { detail: 'boom' }) {
  fetchCalls.length = 0
  global.fetch = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  })
}

afterEach(() => {
  jest.resetAllMocks()
})

// ---------------------------------------------------------------------------
// classifyApiError
// ---------------------------------------------------------------------------
describe('classifyApiError', () => {
  it('HTTP 429 → 재시도 가능, 관리자 문의 불필요', () => {
    const info = classifyApiError(new Error('요청이 너무 많습니다 (HTTP 429)'))
    expect(info.retryable).toBe(true)
    expect(info.contactSupport).toBe(false)
    expect(info.status).toBe(429)
  })

  it('HTTP 503 → 재시도 가능, 관리자 문의 불필요', () => {
    const info = classifyApiError(new Error('서비스 점검 중 (HTTP 503)'))
    expect(info.retryable).toBe(true)
    expect(info.contactSupport).toBe(false)
  })

  it('HTTP 500 → 재시도 불필요, 관리자 문의 필요', () => {
    const info = classifyApiError(new Error('서버 오류 (HTTP 500)'))
    expect(info.contactSupport).toBe(true)
    expect(info.retryable).toBe(false)
  })

  it('HTTP 502 → 관리자 문의 필요', () => {
    const info = classifyApiError(new Error('HTTP 502'))
    expect(info.contactSupport).toBe(true)
  })

  it('HTTP 504 → 재시도 가능, 관리자 문의 불필요 (gateway timeout)', () => {
    const info = classifyApiError(new Error('HTTP 504'))
    expect(info.retryable).toBe(true)
    expect(info.contactSupport).toBe(false)
  })

  it('타임아웃 메시지도 재시도 가능', () => {
    const info = classifyApiError(new Error('요청 시간이 초과되었습니다 (30s)'))
    expect(info.retryable).toBe(true)
  })

  it('객체가 아닌 에러에도 fallback 메시지', () => {
    const info = classifyApiError(null, 'default msg')
    expect(info.message).toBe('default msg')
    expect(info.retryable).toBe(false)
    expect(info.contactSupport).toBe(false)
  })

  it('4xx 클라이언트 에러는 관리자 문의 불필요', () => {
    const info = classifyApiError(new Error('HTTP 400'))
    expect(info.contactSupport).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// makeIdempotencyKey
// ---------------------------------------------------------------------------
describe('makeIdempotencyKey', () => {
  it('호출마다 다른 값 반환', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 100; i++) keys.add(makeIdempotencyKey())
    expect(keys.size).toBe(100)
  })

  it('빈 문자열 반환하지 않음', () => {
    const k = makeIdempotencyKey()
    expect(typeof k).toBe('string')
    expect(k.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// idempotencyKey 파라미터 전파
// ---------------------------------------------------------------------------
describe('idempotencyKey 파라미터 → Idempotency-Key 헤더', () => {
  it('createTicket: opts.idempotencyKey가 헤더에 실린다', async () => {
    mockOk({ iid: 1, title: 't', updated_at: '', labels: [] })
    const key = 'test-key-abc123'
    await createTicket({ title: 'hello', description: 'world' } as any, { idempotencyKey: key })
    const call = fetchCalls[0]
    const headers = (call.init.headers ?? {}) as Record<string, string>
    expect(headers['Idempotency-Key']).toBe(key)
  })

  it('createTicket: opts 없으면 헤더에 Idempotency-Key 없음 (호출부 책임)', async () => {
    mockOk({ iid: 1, title: 't', updated_at: '', labels: [] })
    await createTicket({ title: 'hello', description: 'world' } as any)
    const call = fetchCalls[0]
    const headers = (call.init.headers ?? {}) as Record<string, string>
    // 자동 생성 제거됐으므로 없어야 함
    expect(headers['Idempotency-Key']).toBeUndefined()
  })

  it('addComment: opts.idempotencyKey가 헤더에 실린다', async () => {
    mockOk({ id: 1, body: 'hi', created_at: '' })
    await addComment(1, 'hi', 'proj1', false, { idempotencyKey: 'c-key' })
    const call = fetchCalls[0]
    const headers = (call.init.headers ?? {}) as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('c-key')
  })

  it('bulkUpdateTickets: opts.idempotencyKey가 헤더에 실린다', async () => {
    mockOk({ success: [1], errors: [], summary: { total: 1, succeeded: 1, failed: 0 } })
    await bulkUpdateTickets(
      { iids: [1], project_id: 'p1', action: 'close' },
      { idempotencyKey: 'b-key' },
    )
    const call = fetchCalls[0]
    const headers = (call.init.headers ?? {}) as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('b-key')
  })
})

// ---------------------------------------------------------------------------
// API error message — 상태 코드별 메시지
// ---------------------------------------------------------------------------
describe('parseErrorMessage via classifyApiError flow', () => {
  it('detail 문자열을 그대로 메시지로 사용', async () => {
    mockError(403, { detail: '권한이 없습니다.' })
    await expect(
      createTicket({ title: 'x', description: 'y' } as any, { idempotencyKey: 'k' }),
    ).rejects.toThrow('권한이 없습니다.')
  })

  it('detail이 없으면 상태 코드 기반 fallback', async () => {
    mockError(409, {})
    await expect(
      createTicket({ title: 'x', description: 'y' } as any, { idempotencyKey: 'k' }),
    ).rejects.toThrow(/다른 사용자가 먼저 변경/)
  })

  it('FastAPI validation 배열 포맷 처리', async () => {
    mockError(422, { detail: [{ msg: 'title too short' }, { msg: 'desc required' }] })
    await expect(
      createTicket({ title: '', description: '' } as any, { idempotencyKey: 'k' }),
    ).rejects.toThrow(/title too short.*desc required/)
  })

  it('통합 에러 포맷 {error:{message}} 처리', async () => {
    mockError(500, { error: { code: '500', message: '서버 내부 오류' } })
    await expect(
      createTicket({ title: 'x', description: 'y' } as any, { idempotencyKey: 'k' }),
    ).rejects.toThrow('서버 내부 오류')
  })
})

// ---------------------------------------------------------------------------
// 207 Multi-Status — 부분 실패 bulkUpdate가 throw 없이 구조를 그대로 반환
// ---------------------------------------------------------------------------
describe('bulkUpdateTickets 207 Multi-Status', () => {
  it('207은 2xx이므로 throw 없이 body 그대로 반환', async () => {
    const body = {
      success: [1],
      errors: [{ iid: 2, code: 404, error: '없음' }],
      summary: { total: 2, succeeded: 1, failed: 1 },
    }
    mockOk(body, 207)
    const result = await bulkUpdateTickets(
      { iids: [1, 2], project_id: 'p', action: 'close' },
      { idempotencyKey: 'k' },
    )
    expect(result.summary).toEqual({ total: 2, succeeded: 1, failed: 1 })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe(404)
  })
})
