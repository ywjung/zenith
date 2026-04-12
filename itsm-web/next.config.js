/** @type {import('next').NextConfig} */

// CSP는 nginx에서 일원화 설정 — 중복 헤더 시 브라우저가 양쪽 모두 적용(AND)하여
// 더 엄격한 쪽이 적용되므로 Next.js에서는 CSP를 제외하고 nginx template에서만 관리한다.
// SEC #9: X-XSS-Protection 제거 — Chrome M78에서 deprecated, XS-leak 유발 가능.
// CSP nonce가 더 강력한 XSS 방어를 제공함.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig = {
  output: 'standalone',
  // 서버 버전·프레임워크 노출 방지 (X-Powered-By: Next.js 헤더 제거)
  poweredByHeader: false,
  // React Strict Mode — 개발 시 이중 effect로 버그 조기 발견
  reactStrictMode: true,
  // 프로덕션 브라우저 소스맵 비활성 (기본값이지만 명시 — 민감 로직 노출 방지)
  productionBrowserSourceMaps: false,
  // jsdom reads CSS files via fs.readFileSync at runtime — must NOT be bundled
  serverExternalPackages: ['jsdom', 'isomorphic-dompurify'],

  // 이미지 최적화: WebP/AVIF 자동 변환, 원격 도메인 허용
  // AIRGAP: 외부 이미지 소스 제거 — 폐쇄망에서 external hostname 접근 불가
  // 모든 이미지는 로컬 proxy를 통해 서빙됨
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      // 개발 환경에서만 localhost (로컬 GitLab) 허용
      ...(process.env.NODE_ENV !== 'production' ? [
        { protocol: 'http', hostname: 'localhost' },
        { protocol: 'http', hostname: '127.0.0.1' },
      ] : []),
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
      'sonner',           // toast 25곳 사용 — 트리셰이킹 유리
      'next-intl',        // 30곳 사용
    ],
  },

  async redirects() {
    return [
      // /tickets 라우트 없음 — 홈(티켓 목록)으로 redirect
      { source: '/tickets', destination: '/', permanent: false },
    ]
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
      // Service Worker: 루트 스코프 허용, 캐시 금지(항상 최신 버전 사용)
      {
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      // Web App Manifest
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
          { key: 'Content-Type', value: 'application/manifest+json' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
