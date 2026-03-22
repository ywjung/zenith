/** @type {import('next').NextConfig} */

// CSP는 nginx에서 일원화 설정 — 중복 헤더 시 브라우저가 양쪽 모두 적용(AND)하여
// 더 엄격한 쪽이 적용되므로 Next.js에서는 CSP를 제외하고 nginx template에서만 관리한다.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig = {
  output: 'standalone',
  // jsdom reads CSS files via fs.readFileSync at runtime — must NOT be bundled
  serverExternalPackages: ['jsdom', 'isomorphic-dompurify'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
