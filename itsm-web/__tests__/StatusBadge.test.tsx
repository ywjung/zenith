import { render, screen } from '@testing-library/react'
import { StatusBadge, PriorityBadge, CategoryBadge } from '@/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders open status label', () => {
    render(<StatusBadge status="open" />)
    expect(screen.getByText('접수됨')).toBeTruthy()
  })

  it('renders in_progress status label', () => {
    render(<StatusBadge status="in_progress" />)
    expect(screen.getByText('처리중')).toBeTruthy()
  })

  it('renders resolved status label', () => {
    render(<StatusBadge status="resolved" />)
    expect(screen.getByText('처리완료')).toBeTruthy()
  })

  it('falls back to open style for unknown status', () => {
    render(<StatusBadge status="unknown_status" />)
    // Unknown status falls through to display the key itself
    expect(screen.getByText('unknown_status')).toBeTruthy()
  })

  it('defaults to open when status is undefined', () => {
    render(<StatusBadge />)
    expect(screen.getByText('접수됨')).toBeTruthy()
  })
})

describe('PriorityBadge', () => {
  it('renders medium priority label', () => {
    render(<PriorityBadge priority="medium" />)
    expect(screen.getByText('보통')).toBeTruthy()
  })

  it('renders critical priority label', () => {
    render(<PriorityBadge priority="critical" />)
    expect(screen.getByText('긴급')).toBeTruthy()
  })
})

describe('CategoryBadge', () => {
  it('renders hardware category', () => {
    render(<CategoryBadge category="hardware" />)
    expect(screen.getByText('🖥️ 하드웨어')).toBeTruthy()
  })

  it('renders fallback for undefined category', () => {
    render(<CategoryBadge />)
    expect(screen.getByText('📋 기타')).toBeTruthy()
  })
})
