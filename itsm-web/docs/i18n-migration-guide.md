# i18n 마이그레이션 가이드

한국어 하드코딩을 `next-intl` 기반 i18n으로 전환하는 점진적 마이그레이션 절차.

## 현황 (2026-04-12 기준)

- **인프라**: `next-intl` 설치 완료, `messages/ko.json`, `messages/en.json` 운영
- **이관 완료**: 30 파일 (admin/users, admin/service-types, admin/templates, admin/role-labels 등)
- **잔여**: 58 파일 (admin 11, app 레벨 47)

### 상위 하드코딩 볼륨 (한국어 문자 수)

| 파일 | 문자 수 | 비고 |
|------|--------:|------|
| `app/help/page.tsx` | 40,466 | **MDX 분리 권장** (본문 도움말) |
| `app/tickets/[id]/page.tsx` | 3,399 | 복잡 — 2주 이상 소요 예상 |
| `app/admin/faq/page.tsx` | 1,247 | |
| `app/tickets/new/page.tsx` | 902 | |
| `app/page.tsx` | 757 | 홈 대시보드 |
| `app/reports/page.tsx` | 586 | |
| `app/admin/layout.tsx` | 550 | 관리자 네비 — 우선순위 높음 |
| `app/admin/ai-settings/page.tsx` | 536 | |

## 페이지 마이그레이션 절차

### 1. i18n 키 추가

`messages/ko.json`, `messages/en.json`에 해당 페이지용 네임스페이스 추가:

```json
{
  "admin": {
    "my_page": {
      "title": "내 페이지",
      "subtitle": "설명 텍스트",
      "save": "저장",
      "saving": "저장 중…",
      "count": "{n}개"
    }
  }
}
```

규칙:
- 네임스페이스: `admin.<page_name>` 또는 `<top_level>`
- 이미 존재하는 `common`, `admin.common` 키는 재사용 (중복 금지)
- 동적 값은 ICU placeholder: `"count": "{n}개"`

### 2. 컴포넌트에 hook 도입

```tsx
'use client'
import { useTranslations } from 'next-intl'

export default function Page() {
  const t = useTranslations('admin.my_page')
  // 공통 키 동시 사용 가능
  const tc = useTranslations('common')

  return <h1>{t('title')}</h1>
}
```

### 3. 문자열 치환

- `"저장"` → `{t('save')}`
- `"저장 실패"` → `errorMessage(e, t('save_failed'))`
- 동적 값: `t('count', { n: 5 })`
- 조건 분기 문자열은 키 분리: `t(active ? 'active' : 'inactive')`

### 4. 타입 안전 키 (선택)

동적 키 사용 시 TypeScript 오류 회피:

```tsx
t(`desc_${role}` as 'desc_admin')
```

### 5. 검증

```bash
cd itsm-web
npx tsc --noEmit --skipLibCheck -p .
# 빌드 확인
npm run build
```

## 모범 사례 — `role-labels/page.tsx`

참고: `itsm-web/src/app/admin/role-labels/page.tsx`가 최소한의 마이그레이션 패턴 예시.
189줄 페이지를 2 커밋으로 완전 이관 (키 추가 + 페이지 전환).

## help 페이지 MDX 분리 설계

`app/help/page.tsx`는 4만자 이상의 도움말 본문이 JSX에 직접 포함됨. i18n 이관보다 **MDX 파일 분리**가 적절.

### 제안 구조

```
itsm-web/
├── content/
│   └── help/
│       ├── ko/
│       │   ├── index.mdx          # 메인 목차
│       │   ├── tickets.mdx
│       │   ├── workflow.mdx
│       │   ├── architecture.mdx
│       │   └── ...
│       └── en/
│           ├── index.mdx
│           └── ...
├── src/app/help/
│   ├── page.tsx                    # MDX 로더 (로케일 감지 → 해당 디렉토리)
│   └── [topic]/page.tsx            # 토픽별 라우트
```

### 도입 단계

1. `@next/mdx`, `@mdx-js/react` 설치
2. `next.config.js`에 MDX 플러그인 등록
3. `app/help/page.tsx`를 섹션별로 분리하여 `content/help/ko/*.mdx`에 이전
4. 동적 import: `import(`@/content/help/${locale}/${topic}.mdx`)`
5. ko 이관 후 en 번역은 번역팀/LLM 파이프라인에 위임

### 기대 효과

- 번들 사이즈 약 100KB+ 감소 (MDX 동적 로딩)
- 번역가가 JSON 대신 Markdown 편집 가능
- 로케일 추가(일본어·중국어 등) 시 파일 복사만으로 처리

## 주당 목표치

지속적 전환을 위한 권장 페이스:
- **Week 1~2**: admin 소규모 페이지 5개 (api-keys, email-templates, db-cleanup, email-ingest, search-index)
- **Week 3~4**: admin layout + 중규모 페이지 (faq, ip-allowlist)
- **Week 5~6**: help 페이지 MDX 분리 (설계 + 첫 3개 섹션)
- **Week 7~8**: app 레벨 (tickets/new, profile, reports)
- **Week 9~10**: help 페이지 나머지 섹션
- **Week 11+**: tickets/[id] 대형 페이지

## 도움 도구

하드코딩 탐지 스크립트:

```bash
python3 -c "
import re, pathlib
KO = re.compile(r'[\uAC00-\uD7AF]')
for p in pathlib.Path('src').rglob('*.tsx'):
    n = len(KO.findall(p.read_text()))
    if n > 30: print(f'{n:5d} {p}')
" | sort -rn
```

PR 전 검증:

```bash
# 해당 페이지에 여전히 한글이 남았는지 확인
grep -c '[가-힣]' src/app/admin/my_page/page.tsx
# 이상적으로는 주석(#)과 테스트 ID 내 한글만 남아야 함
```
