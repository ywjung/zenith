/**
 * Tests for src/lib/api.ts using fetch mocks.
 */

// Set env var before module import
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost/api'

import { fetchTickets, fetchTicket, createTicket, fetchRating } from '@/lib/api'

const MOCK_TICKET = {
  iid: 1,
  title: '프린터 고장',
  description: '연결 안됨',
  state: 'opened',
  labels: ['cat::hardware', 'prio::medium', 'status::open'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  web_url: 'http://gitlab/issues/1',
  employee_name: '홍길동',
  employee_email: 'hong@example.com',
  category: 'hardware',
  priority: 'medium',
  status: 'open',
}

function mockFetch(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    statusText: 'OK',
  } as unknown as Response)
}

afterEach(() => {
  jest.resetAllMocks()
})

describe('fetchTickets', () => {
  it('calls /tickets/ endpoint', async () => {
    mockFetch([MOCK_TICKET])
    const tickets = await fetchTickets()
    expect(tickets).toHaveLength(1)
    expect(tickets[0].iid).toBe(1)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tickets/'),
      expect.any(Object),
    )
  })

  it('passes state query param', async () => {
    mockFetch([])
    await fetchTickets({ state: 'open' })
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toContain('state=open')
  })

  it('passes category query param', async () => {
    mockFetch([])
    await fetchTickets({ category: 'hardware' })
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toContain('category=hardware')
  })
})

describe('fetchTicket', () => {
  it('calls /tickets/{iid} endpoint', async () => {
    mockFetch(MOCK_TICKET)
    const ticket = await fetchTicket(1)
    expect(ticket.iid).toBe(1)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tickets/1'),
      expect.any(Object),
    )
  })
})

describe('createTicket', () => {
  it('sends POST to /tickets/', async () => {
    mockFetch(MOCK_TICKET, 201)
    const payload = {
      title: '네트워크 불량',
      description: '인터넷이 안됩니다.',
      category: 'network',
      priority: 'high',
      employee_name: '김철수',
      employee_email: 'kim@example.com',
    }
    const ticket = await createTicket(payload)
    expect(ticket.iid).toBe(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/tickets/')
    expect(init.method).toBe('POST')
  })
})

describe('fetchRating', () => {
  it('returns null for 404 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue(null),
    } as unknown as Response)
    const rating = await fetchRating(999)
    expect(rating).toBeNull()
  })

  it('returns rating data on success', async () => {
    const mockRating = { id: 1, gitlab_issue_iid: 1, score: 5, employee_name: '홍길동' }
    mockFetch(mockRating)
    const rating = await fetchRating(1)
    expect(rating?.score).toBe(5)
  })
})
