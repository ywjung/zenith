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

  // 이미지 최적화: WebP/AVIF 자동 변환, 원격 도메인 허용
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.gitlab.com' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
    ],
    minimumCacheTTL: 3600,
  },

  // 번들 압축 최적화
  compress: true,

  // 실험적 기능: 패키지 import 최적화 (트리쉐이킹 강화)
  experimental: {
    optimizePackageImports: [
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@hello-pangea/dnd',
      'react-markdown',
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      // 정적 자산 장기 캐시
      {
        source: '/_next/static/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

module.exports = nextConfig
