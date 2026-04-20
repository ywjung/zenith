/**
 * SessionExpireWarning 버그 회귀 테스트.
 *
 * 주요 버그: "나중에" 버튼이 setShow(false)만 해서 1초 뒤 tick이 다시 setShow(true)로 복원.
 * 수정: dismissedExpRef로 현재 exp에 대해 재표시 억제.
 */
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost/api'

import React from 'react'
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// AuthContext 모킹 — 상대 경로 사용 (jest.mock 호이스팅 + 별칭 해석 제약)
// 중요: user 객체를 모듈 스코프 상수로 두어 매 렌더마다 같은 참조 반환
// (다른 객체를 반환하면 effect deps가 변해 fetchExp가 무한 재호출됨).
jest.mock('../src/context/AuthContext', () => {
  const mockUser = { sub: '42', username: 'tester' }
  const mockAuth = { user: mockUser, isAdmin: false }
  return { useAuth: () => mockAuth }
})

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

import SessionExpireWarning from '@/components/SessionExpireWarning'

function mockFetchMe(expInSeconds: number) {
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url.includes('/auth/me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ exp: Math.floor(Date.now() / 1000) + expInSeconds }),
      } as unknown as Response
    }
    if (url.includes('/auth/refresh')) {
      return { ok: true, status: 200 } as unknown as Response
    }
    return { ok: false, status: 500 } as unknown as Response
  })
}

describe('SessionExpireWarning', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('exp 만료 2분 이내일 때 모달이 표시된다', async () => {
    mockFetchMe(60)  // 60초 후 만료
    await act(async () => {
      render(<SessionExpireWarning />)
    })
    // fetchExp 완료 대기
    await act(async () => { await Promise.resolve() })
    // tick 1회 진행
    await act(async () => { jest.advanceTimersByTime(1000) })

    expect(screen.queryByText(/세션이 곧 만료됩니다/i)).toBeInTheDocument()
  })

  it('"나중에" 클릭 후에도 모달이 다시 나타나지 않는다 (회귀)', async () => {
    mockFetchMe(60)
    await act(async () => {
      render(<SessionExpireWarning />)
    })
    // fetchExp + setExp + effect 실행 대기
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    // 최초 tick은 effect 내부에서 이미 실행되었으므로 show=true 상태.
    expect(screen.queryByText(/세션이 곧 만료됩니다/i)).toBeInTheDocument()

    // "나중에" 클릭
    const dismissBtn = screen.getByRole('button', { name: /나중에/i })
    await act(async () => {
      fireEvent.click(dismissBtn)
    })
    // 모달 즉시 사라짐
    expect(screen.queryByText(/세션이 곧 만료됩니다/i)).not.toBeInTheDocument()

    // 여러 번 tick이 흘러도 모달이 복원되지 않아야 한다.
    for (let i = 0; i < 5; i++) {
      await act(async () => { jest.advanceTimersByTime(1000) })
    }
    expect(screen.queryByText(/세션이 곧 만료됩니다/i)).not.toBeInTheDocument()
  })

  it('만료까지 충분히 멀면 모달이 나타나지 않는다', async () => {
    mockFetchMe(3600)  // 1시간 후 만료
    await act(async () => {
      render(<SessionExpireWarning />)
    })
    await act(async () => { await Promise.resolve() })
    await act(async () => { jest.advanceTimersByTime(1000) })

    expect(screen.queryByText(/세션이 곧 만료됩니다/i)).not.toBeInTheDocument()
  })
})
