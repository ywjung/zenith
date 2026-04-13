import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * JWT payload 디코딩 (서명 미검증 — Edge Runtime 한계).
 * 서버측 실제 권한 검증은 백엔드 API가 담당하며,
 * 여기서는 잘못된 역할의 사용자가 어드민 UI를 렌더링하는 것을 막는 용도.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(payload)
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * H2: nonce 기반 CSP — 'unsafe-inline' 제거
 *
 * 각 요청마다 cryptographic nonce를 생성하여:
 *  1. Content-Security-Policy 응답 헤더에 포함
 *  2. x-nonce 요청 헤더로 Server Components(layout.tsx)에 전달
 *
 * script-src에 nonce를 사용하면 'unsafe-inline' 없이
 * 특정 인라인 스크립트(다크모드 FOUC 방지 등)만 허용 가능.
 *
 * HIGH-1: /admin 경로는 JWT role==admin 검증 추가.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /admin 경로: 토큰 없거나 role != admin이면 /login 리다이렉트 (원래 경로는 ?next= 에 보존)
  if (pathname.startsWith('/admin')) {
    const token = request.cookies.get('itsm_token')?.value
    const redirectToLogin = () => {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      loginUrl.search = ''
      loginUrl.searchParams.set('next', pathname + (request.nextUrl.search || ''))
      return NextResponse.redirect(loginUrl)
    }
    if (!token) return redirectToLogin()
    const payload = decodeJwtPayload(token)
    if (!payload || payload.role !== 'admin') return redirectToLogin()
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  // AIRGAP: 외부 도메인 제거 — 폐쇄망에서 Gravatar 등 외부 이미지 차단됨
  // 사용자 아바타는 로컬 Avatar 컴포넌트(hash 색상 이니셜)로 대체
  const isDev = process.env.NODE_ENV !== 'production'
  const imgSrc = [
    "'self'",
    'data:',
    'blob:',
    ...(isDev ? ['http://localhost:8929'] : []),
  ].join(' ')

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // style-src: React의 style prop이 인라인 스타일 속성으로 렌더링되어 'unsafe-inline' 필요.
    // 사용자 입력의 CSS injection은 DOMPurify ALLOWED_ATTR에 'style' 미포함으로 차단됨.
    // TODO: Tailwind CSS 클래스로 모든 inline style 대체 후 'unsafe-inline' 제거 가능.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "connect-src 'self'",
    "font-src 'self'",
    // SEC #8: frame-src 'self' only — blob: 제거. PDF preview는 same-origin proxy URL 사용.
    "frame-src 'self'",
    // object-src: Flash·Java 플러그인 완전 차단
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    // 정적 파일과 Next.js 내부 경로 제외
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js).*)',
  ],
}
