'use client'

import Link from 'next/link'
import { useState } from 'react'

/* ─── 탭 정의 ──────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'start',    label: '시작하기' },
  { id: 'features', label: '기능 안내' },
  { id: 'process',  label: '업무 프로세스' },
  { id: 'workflow', label: '워크플로우 & SLA' },
  { id: 'rbac',     label: '권한 & 비교' },
  { id: 'perf',     label: '성능 & 안정화' },
  { id: 'arch',     label: '아키텍처' },
  { id: 'api',      label: 'API 문서' },
  { id: 'faq',      label: 'FAQ' },
] as const
type TabId = typeof TABS[number]['id']

/* ─── 공통 데이터 ─────────────────────────────────────────────────────── */

const QUICK_LINKS = [
  { href: '/tickets/new', emoji: '🎫', label: '티켓 등록',    desc: '새 IT 지원 요청',      color: 'border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700' },
  { href: '/portal',      emoji: '🌐', label: '고객 포털',    desc: '비로그인 접수',         color: 'border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700' },
  { href: '/kanban',      emoji: '🗂️', label: '칸반 보드',    desc: '드래그앤드롭 관리',     color: 'border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700' },
  { href: '/kb',          emoji: '📚', label: '지식베이스',   desc: '자가 해결 검색',        color: 'border-green-200 bg-green-50 hover:bg-green-100 text-green-700' },
  { href: '/reports',     emoji: '📊', label: '리포트',       desc: '현황·성과 분석',        color: 'border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700' },
  { href: 'http://localhost:8111/docs', emoji: '📖', label: 'Swagger UI', desc: 'API 명세 확인', color: 'border-pink-200 bg-pink-50 hover:bg-pink-100 text-pink-700' },
]

const REGISTRATION_STEPS = [
  { step: 1, icon: '🖱️', title: '새 티켓 등록 클릭',        desc: '헤더의 "+ 새 티켓 등록" 버튼을 클릭합니다.',                                                                                                 tip: null },
  { step: 2, icon: '📋', title: '템플릿 선택 (선택)',         desc: '자주 발생하는 유형에 맞는 템플릿을 선택하면 제목·내용이 자동 입력됩니다.',                                                                    tip: '템플릿을 사용하면 필수 정보 누락 없이 빠르게 작성할 수 있습니다.' },
  { step: 3, icon: '📁', title: '프로젝트 선택',              desc: '요청을 처리할 IT 팀 프로젝트를 선택합니다.',                                                                                                 tip: null },
  { step: 4, icon: '✏️', title: '제목 입력',                  desc: '문제를 한 문장으로 간결하게 작성합니다. 제목이 6자 이상이면 관련 KB 아티클이 자동으로 추천됩니다.',                                           tip: '"컴퓨터가 켜지지 않습니다" 처럼 증상 중심으로 작성하세요.' },
  { step: 5, icon: '🏷️', title: '카테고리 및 긴급도 선택',   desc: '문제 유형과 업무 영향도를 선택합니다. "기밀 티켓" 체크박스를 선택하면 GitLab에 비공개 이슈로 생성됩니다.',                                    tip: '업무가 완전히 불가능하면 "긴급"을 선택하세요. 긴급도에 따라 SLA 목표 시간이 달라집니다.' },
  { step: 6, icon: '📝', title: '상세 내용 작성',             desc: '언제부터 발생했는지, 어떤 증상인지, 이미 시도한 방법 등을 상세히 기재합니다. 주의: 비밀번호·API 키 등 민감 정보는 입력하지 마세요.',          tip: '스크린샷이나 오류 메시지가 있으면 파일 첨부 기능으로 업로드하세요.' },
  { step: 7, icon: '📤', title: '신청자 정보 확인 및 제출',   desc: 'GitLab 계정 정보가 자동 입력됩니다(읽기 전용). 부서와 위치를 추가하면 IT팀이 더 빠르게 대응할 수 있습니다.',                                   tip: null },
]

const CATEGORIES_INFO = [
  { emoji: '🖥️', label: '하드웨어',   color: 'bg-orange-50 border-orange-200', examples: ['PC·노트북 부팅 불가', '모니터 화면 이상', '프린터 인쇄 오류', '장비 교체·대여 요청'] },
  { emoji: '💻', label: '소프트웨어', color: 'bg-red-50 border-red-200',       examples: ['프로그램 설치 요청', '업무용 앱 오류', 'OS 업데이트 문제', '소프트웨어 개발·유지보수'] },
  { emoji: '🌐', label: '네트워크',   color: 'bg-purple-50 border-purple-200', examples: ['인터넷 연결 불가', 'VPN 접속 오류', '공유폴더 접근 불가', '무선 Wi-Fi 문제'] },
  { emoji: '👤', label: '계정/권한',  color: 'bg-teal-50 border-teal-200',     examples: ['비밀번호 초기화', '시스템 접근 권한 요청', '계정 잠금 해제', '신규 계정 생성'] },
  { emoji: '📋', label: '기타',       color: 'bg-gray-50 border-gray-200',     examples: ['위 카테고리에 해당하지 않는 IT 지원', '장비 이전·설치 요청'] },
]

/* ─── 기능 안내 데이터 ────────────────────────────────────────────────── */

const ALL_FEATURES: { emoji: string; title: string; note: string; desc: string; isNew?: boolean }[] = [
  { emoji: '🎫', title: '티켓 CRUD + 파일 첨부',              note: '현업 사용자 이상',                                      desc: '티켓 생성·조회·수정과 스크린샷·로그 파일 첨부(최대 10MB)를 지원합니다. 파일은 매직바이트로 형식을 검증합니다.' },
  { emoji: '🔎', title: '글로벌 티켓 검색 (⌘K)',              note: '로그인 사용자 전체',                                    desc: '헤더 검색창 또는 ⌘K(Ctrl+K) 단축키로 전체 티켓을 실시간 검색합니다. GitLab 이슈 검색 API를 활용해 제목·설명을 대상으로 검색하며 300ms 디바운스로 자동완성됩니다. 화살표 키 탐색 및 Enter 선택, Esc로 닫기를 지원합니다.' },
  { emoji: '⌨️', title: '키보드 단축키',                      note: '로그인 사용자 전체',                                    desc: 'g+t(티켓 목록), g+k(칸반), g+b(지식베이스), g+r(리포트), g+a(관리), n(새 티켓 등록), ?(단축키 도움말). 입력 필드에서는 자동 비활성화됩니다.', isNew: true },
  { emoji: '🗂️', title: '칸반 보드',                          note: 'IT 개발자 이상 · /kanban',                             desc: '8개 상태 컬럼(접수됨·승인완료·처리중·대기중·처리완료·운영배포전·운영반영완료·종료)을 드래그앤드롭으로 티켓 상태를 직접 변경합니다. 우선순위·담당자 필터로 원하는 카드만 표시하고, SLA 초과 카드는 빨간색(⚠️), 여유 카드는 초록색으로 구분합니다.' },
  { emoji: '🚫', title: '칸반 드래그 전환 규칙 강제',         note: 'IT 개발자 이상 · /kanban',                             desc: '카드 드래그 시작 순간, 현재 상태에서 이동이 허용되지 않는 컬럼이 자동으로 흐리게(opacity 40%) 비활성화되고 🚫 아이콘이 표시됩니다. 허용된 컬럼만 파란 하이라이트로 강조됩니다. 백엔드 VALID_TRANSITIONS와 동일한 규칙을 프론트에서 사전 적용하여 API 실패 후 카드가 원위치로 돌아오는 불필요한 UX를 방지합니다.', isNew: true },
  { emoji: '🔍', title: '고급 검색 & URL 동기화',             note: '현업 사용자 이상',                                     desc: '상태·카테고리·우선순위·SLA·신청자·기간 등 복합 필터를 URL로 동기화하여 브라우저 뒤로가기·북마크가 가능합니다.' },
  { emoji: '⭐', title: '즐겨찾기 필터 저장',                  note: 'IT 개발자 이상',                                        desc: '자주 쓰는 필터 조합을 이름 붙여 저장하고 한 번에 적용합니다.' },
  { emoji: '☑️', title: '일괄 작업',                           note: 'IT 관리자 이상',                                       desc: '여러 티켓을 체크박스로 선택하여 종료·담당자 배정·우선순위 변경을 한 번에 처리합니다.' },
  { emoji: '🔒', title: '내부 메모',                           note: 'IT 개발자 이상',                                       desc: '신청자에게 보이지 않는 비공개 메모를 댓글로 남길 수 있습니다. 노란 배경으로 구분됩니다.' },
  { emoji: '🔗', title: '연관 티켓 링크',                      note: 'IT 개발자 이상',                                       desc: '티켓 간 관련·선행·중복 관계를 연결하여 복합 장애 대응 시 전체 현황을 파악합니다.' },
  { emoji: '⏱️', title: '시간 기록',                           note: 'IT 개발자 이상',                                       desc: '티켓 처리에 소요된 시간을 분 단위로 기록하고 누적 처리 시간을 표시합니다.' },
  { emoji: '📤', title: '개발 프로젝트 전달',                  note: 'IT 개발자 이상',                                       desc: '소프트웨어 개발이 필요한 경우 티켓을 개발팀 GitLab 프로젝트로 이슈를 전달합니다. 드롭다운에는 현재 로그인한 사용자의 GitLab OAuth 토큰 기준 "멤버로 등록된 프로젝트(ITSM 전용 프로젝트 제외)"만 표시됩니다. 전달 이력(프로젝트·이슈 번호·메모·일시)이 티켓에 기록됩니다.' },
  { emoji: '🔀', title: 'GitLab MR 연결 조회',                 note: 'IT 개발자 이상',                                       desc: '티켓과 연결된 GitLab Merge Request 목록(제목·상태·작성자)을 상세 화면에서 바로 확인합니다.' },
  { emoji: '🔔', title: '인앱 실시간 알림',                    note: '전체',                                                  desc: '헤더 🔔 벨 아이콘에서 상태 변경·댓글·배정 등의 알림을 SSE로 실시간 수신합니다.' },
  { emoji: '🔔', title: '알림 & 구독 통합 관리',                note: '전체 · /notifications',                                 desc: '/notifications 페이지는 두 탭으로 구성됩니다. ① 구독 중인 티켓: 내가 Watcher로 등록한 티켓 목록 조회 및 구독 취소. ② 알림 수신 설정: 6가지 이벤트(티켓 생성·상태 변경·댓글·담당자 배정·SLA 임박·SLA 위반)별로 이메일/인앱 알림을 개별적으로 켜고 끌 수 있습니다. 헤더 알림 벨 드롭다운 하단 링크에서 바로 접근할 수 있습니다.', isNew: true },
  { emoji: '📢', title: '공지사항/배너',                       note: 'Admin 등록 · 전체 노출',                                desc: '관리자가 info/warning/critical 유형의 시스템 공지를 등록하면 로그인한 모든 사용자의 화면 상단에 배너로 표시됩니다. X 버튼으로 개별 숨김 처리가 가능합니다.', isNew: true },
  { emoji: '⭐', title: '만족도 평가',                          note: '전체',                                                  desc: '종료된 티켓에 1~5점 별점과 한 줄 코멘트를 남겨 서비스 품질 개선에 기여합니다.' },
  { emoji: '📚', title: '지식베이스 (KB)',                      note: 'IT 개발자 이상 작성',                                   desc: 'PostgreSQL FTS 전문 검색·태그 필터·카테고리 분류를 지원하는 지식베이스입니다. Markdown 형식으로 작성합니다.' },
  { emoji: '💡', title: 'KB 자동 추천',                        note: '티켓 등록 시 전체 사용자',                              desc: '티켓 제목을 6자 이상 입력하면 300ms 디바운스로 관련 KB 아티클을 자동 추천합니다. /kb/suggest API와 PostgreSQL FTS를 기반으로 동작합니다.', isNew: true },
  { emoji: '📊', title: '리포트 & 에이전트 성과',              note: 'IT 관리자 이상',                                        desc: '전체 현황(신규·종료·SLA 위반·만족도)과 담당자별 성과(처리 건수·SLA 달성률·평균 평점)를 확인합니다.' },
  { emoji: '📥', title: '티켓 CSV 내보내기',                   note: 'IT 에이전트 이상 · /tickets/export/csv',               desc: '현재 필터 조건이 그대로 적용된 티켓 목록을 CSV 파일로 다운로드합니다. UTF-8 BOM으로 엑셀에서 즉시 열 수 있습니다.', isNew: true },
  { emoji: '🧬', title: '티켓 복제(Clone)',                    note: 'IT 개발자 이상',                                        desc: 'POST /tickets/{iid}/clone 으로 티켓의 제목·카테고리·우선순위·본문을 복사하여 새 티켓을 생성합니다. 원본 티켓과 related 링크가 자동 연결되고, 복제 알림 댓글이 자동 추가됩니다.', isNew: true },
  { emoji: '🔐', title: 'GitLab Confidential Issue',           note: '티켓 등록 시 전체 사용자',                              desc: '티켓 등록 시 "기밀 티켓" 체크박스를 선택하면 GitLab에 confidential=true로 이슈가 생성됩니다. IT 에이전트 이상 역할만 해당 티켓을 조회할 수 있습니다.', isNew: true },
  { emoji: '🤖', title: '자동 담당자 배정',                    note: '시스템 관리자 설정',                                    desc: '카테고리·우선순위·키워드 조건 규칙을 설정하면 신규 티켓 접수 시 담당자가 자동 배정됩니다.' },
  { emoji: '🚨', title: 'SLA 에스컬레이션 자동 정책',          note: 'IT 시스템 관리자 설정 · /admin/escalation-policies',   desc: 'SLA 위반/임박 시 자동으로 실행할 정책을 설정합니다. 알림 발송·담당자 변경·우선순위 자동 상향 3가지 액션과 우선순위·트리거·지연 시간 조건을 조합합니다. SLA 체커 스레드(5분 주기)에서 실행되며 중복 실행을 방지합니다.' },
  { emoji: '⏰', title: 'SLA 정책 관리 (DB화)',                 note: '시스템 관리자',                                         desc: '우선순위별 응답·해결 목표 시간을 UI에서 직접 수정합니다. 변경 즉시 신규 티켓부터 적용됩니다.' },
  { emoji: '📧', title: '이메일 템플릿 관리',                   note: 'IT 시스템 관리자 · /admin/email-templates',            desc: '이벤트별 이메일 알림 내용을 Jinja2 템플릿 문법으로 커스터마이즈합니다. 미리보기로 샘플 데이터 렌더링을 확인한 후 저장합니다. DB 템플릿 우선 적용, 없으면 하드코딩 폴백.' },
  { emoji: '🏷️', title: '서비스 유형 동적 관리',               note: '시스템 관리자 · /admin/service-types',                  desc: '카테고리(서비스 유형)를 DB에서 관리합니다. 관리자 UI에서 이모지·색상·이름·하위 선택지를 추가·수정·삭제할 수 있으며 즉시 티켓 등록 폼에 반영됩니다. 추가·수정 시 GitLab에 cat::{id} 라벨이 자동 동기화됩니다. 사용 중인 티켓이 있는 서비스 유형은 삭제가 차단되며, 뱃지로 사용 현황이 표시됩니다.' },
  { emoji: '🗒️', title: '감사 로그',                            note: 'IT 관리자 이상',                                        desc: '티켓 생성·수정·삭제·역할 변경·일괄 작업 등 주요 이벤트의 수행자 이름·역할(배지)·IP 주소·타임스탬프를 추적합니다. 기간·액션·행위자 검색 필터와 CSV 다운로드, 페이지네이션을 지원합니다.' },
  { emoji: '📣', title: 'Telegram·이메일 알림',                 note: '시스템 관리자 설정',                                    desc: '티켓 생성·상태 변경·SLA 위반 시 Telegram 채널과 이메일로 자동 알림이 발송됩니다. SLA 해결 기한 1시간 전에도 담당자에게 사전 경고 알림이 전송됩니다.' },
  { emoji: '🔗', title: '아웃바운드 웹훅',                      note: 'IT 시스템 관리자 · /admin/outbound-webhooks',          desc: 'Slack Incoming Webhook, Teams Power Automate 등 외부 서비스와 즉시 연동합니다. HMAC-SHA256 서명, 3회 지수 백오프 재시도를 지원합니다.', isNew: true },
  { emoji: '🔑', title: 'API 키 인증',                          note: 'Admin 발급 · /admin/api-keys',                         desc: 'Authorization: Bearer itsm_live_xxxx 헤더로 외부 시스템에서 ITSM API를 호출할 수 있습니다. 스코프: tickets:read, tickets:write, kb:read, kb:write, webhooks:write. API 키는 SHA-256 해시로 저장(평문 미보관)됩니다.', isNew: true },
  { emoji: '🌐', title: '고객 셀프서비스 포털',                 note: '비로그인 공개 · /portal',                               desc: 'GitLab 계정 없이도 이름·이메일·제목·내용만으로 IT 지원을 요청할 수 있습니다. 접수 후 발급된 토큰 링크(/portal/track/{token})로 티켓 진행 상황을 실시간 확인합니다. 포털 제출은 분당 5건 Rate Limit이 적용됩니다.' },
  { emoji: '⏸️', title: 'SLA 일시정지/재개',                   note: '자동 (waiting 상태 연동)',                              desc: '티켓 상태가 "대기중(waiting)"으로 전환되면 SLA 타이머가 자동으로 일시정지됩니다. 상태가 변경되면 정지된 시간(total_paused_seconds)을 제외하고 SLA 경과 시간을 계산합니다.' },
  { emoji: '✉️', title: 'IMAP 이메일 → 티켓 자동 생성',        note: '시스템 관리자 설정 (IMAP_ENABLED=true)',                 desc: '지정한 이메일 수신함을 60초 간격으로 폴링하여 새 메일을 티켓으로 자동 변환합니다. Message-ID를 Redis에 30일 TTL로 저장하여 중복 생성을 방지하고, 접수 확인 이메일을 발신자에게 자동 회신합니다.' },
  { emoji: '🔀', title: 'MR 머지 → 티켓 자동 해결',            note: '자동 (GitLab 웹훅 연동)',                               desc: 'GitLab Merge Request 설명에 "Closes #N", "Fixes #N", "#N" 패턴을 포함하면, MR 머지 시 해당 티켓이 자동으로 "resolved" 상태로 전환되고 자동 코멘트가 추가됩니다.' },
  { emoji: '📝', title: '리치 텍스트 에디터 (TipTap)',          note: 'IT 개발자 이상 (티켓·KB 작성)',                         desc: 'TipTap 기반 WYSIWYG 에디터로 Bold·Italic·코드블록·순서 없는 목록·표·이미지 삽입을 지원합니다. 이미지는 파일 선택 → 서버 업로드 → 에디터 자동 삽입 방식으로 처리됩니다.' },
  { emoji: '💬', title: '빠른 답변 템플릿',                     note: 'IT 에이전트 이상 · /admin/quick-replies',               desc: '자주 사용하는 답변을 이름·카테고리·내용으로 서버에 등록해 두면, 코멘트 입력 시 드롭다운에서 선택하여 내용을 자동 채울 수 있습니다.' },
  { emoji: '🔔', title: '티켓 구독 (Watcher)',                  note: '전체 · 티켓 상세 화면',                                 desc: '티켓 상세 화면 우측 사이드바 하단의 "🔕 이 티켓 구독" 버튼을 클릭하면 구독자로 등록됩니다. 이후 상태 변경·공개 댓글 등록 시 이메일 알림을 받습니다. 내부 메모(🔒)는 알림에서 제외됩니다. ※ 구독자 알림은 현재 이메일 전용이며 인앱(벨) 알림은 지원되지 않습니다. 담당자나 신청자가 아닌 사람도 구독할 수 있어 관련 팀원이 진행 상황을 추적할 때 유용합니다.' },
  { emoji: '🔖', title: '커밋 메시지 → 티켓 자동 참조',        note: '자동 (GitLab Push Hook)',                               desc: 'GitLab 커밋 메시지에 "Closes #N", "Fixes #N", "Refs #N" 패턴을 포함하면 Push Hook 수신 시 해당 ITSM 티켓에 커밋 링크와 저자가 자동 코멘트로 기록됩니다.' },
  { emoji: '🚨', title: 'GitLab 파이프라인 실패 알림',          note: '자동 (GitLab Pipeline Hook)',                           desc: 'GitLab CI/CD 파이프라인이 실패하면, MR 또는 커밋 메시지에서 참조된 ITSM 티켓에 파이프라인 실패 코멘트가 자동으로 추가됩니다.' },
  { emoji: '🔄', title: '퇴사자 계정 자동 동기화',              note: '시스템 자동 (1시간 주기)',                               desc: 'GitLab 그룹 멤버십을 1시간마다 자동 동기화합니다. 퇴사하거나 그룹에서 제거된 사용자는 다음 로그인 시 자동으로 접근이 차단됩니다(403). USER_SYNC_INTERVAL 환경변수로 주기 조정 가능합니다.' },
  { emoji: '📱', title: '모바일 반응형 지원',                   note: '전체 · 모바일 브라우저',                                desc: '768px 미만 화면에서 햄버거 메뉴로 전환됩니다. 터치 영역 최소 44px 보장(WCAG 2.5.5), 모바일 카드 테이블 레이아웃을 지원합니다.' },
  { emoji: '📜', title: '타임라인 통합 뷰',                     note: 'IT 개발자 이상 · 티켓 상세',                            desc: '티켓 상세 화면의 "타임라인" 탭에서 댓글·감사로그·GitLab 시스템 노트를 시간순으로 통합해 표시합니다. 이벤트 유형별 색상 구분(댓글/시스템/감사), 세로 타임라인 연결선, 아바타·작성자·액션 레이블 표시를 지원합니다.', isNew: true },
  { emoji: '🖼️', title: '첨부파일 인라인 미리보기',             note: '전체 · 티켓 상세',                                      desc: '첨부 이미지는 썸네일 클릭 → 라이트박스(전체 화면 오버레이)로 확대 보기와 다운로드를 지원합니다. PDF 첨부파일은 "미리보기" 버튼 클릭 시 모달 내 iframe으로 인라인 렌더링됩니다.', isNew: true },
  { emoji: '🕐', title: '검색 히스토리 (⌘K)',                   note: '전체 · 글로벌 검색',                                    desc: '⌘K 검색창에서 최근 검색어 최대 6개를 localStorage에 자동 저장합니다. 검색 결과로 이동 시 히스토리에 추가되며, 아이템별 개별 삭제와 전체 삭제를 지원합니다. 검색어가 없을 때 히스토리 목록이 자동으로 표시됩니다.', isNew: true },
  { emoji: '📋', title: '해결 노트 + KB 변환',                   note: 'IT 에이전트 이상 · 티켓 처리완료·종료 시',              desc: '티켓을 "처리완료" 또는 "종료"로 전환할 때 해결 내용·해결 유형(즉시 해결/임시 조치/외부 의뢰 등)·원인을 구조화된 노트로 기록합니다. 해결 노트는 티켓 상세의 만족도 평가 위에 표시됩니다. 에이전트 이상은 📚 KB 아티클로 변환 버튼을 통해 해결 노트를 지식베이스 초안으로 즉시 변환할 수 있습니다.', isNew: true },
  { emoji: '📊', title: '비즈니스 KPI 모니터링',                note: '시스템 관리자 · Grafana :3001',                         desc: 'Prometheus 커스텀 메트릭(27종)을 5분 주기로 DB에서 집계합니다. Grafana "ITSM 메뉴별 운영 현황" 대시보드(4번째)에서 티켓·KB·칸반·리포트·관리 메뉴별 KPI(SLA 위반 수·KB 게시율·알림 확인율·사용자 역할 분포 등)를 시각화합니다.', isNew: true },
  { emoji: '🔑', title: 'Sudo 모드 (관리자 재인증)',             note: 'Admin 전용',                                            desc: '민감한 관리 작업 수행 전 GitLab 비밀번호로 재인증하는 Sudo 토큰 시스템입니다. 15분 유효하며, 사용자 역할 변경·세션 강제 종료 등 고위험 작업에 적용됩니다.', isNew: true },
  { emoji: '🏷️', title: 'GitLab 라벨 동기화 관리',              note: 'Admin 전용 · /admin/labels',                            desc: 'status::/prio::/cat:: 라벨이 GitLab 프로젝트·그룹 양쪽에 존재하는지 현황 표시(✅/❌)와 수동 동기화 기능을 제공합니다. 서비스 유형 추가·수정 시 cat::{id} 라벨이 자동 동기화됩니다. 라벨은 생성·색상 업데이트만 수행하며 절대 삭제하지 않습니다(삭제 시 GitLab이 이슈 라벨을 자동 제거).', isNew: true },
  { emoji: '📋', title: '구독 중인 티켓 목록',                   note: '전체 · /notifications',                                 desc: '헤더 알림 벨 → "구독 중인 티켓" 또는 /notifications 페이지의 첫 번째 탭에서 내가 구독 중인 모든 티켓 목록을 확인하고 구독 취소할 수 있습니다. 각 티켓의 제목·상태·우선순위·담당자·구독일이 표시되며 구독 취소는 🔕 버튼으로 즉시 적용됩니다.', isNew: true },
  { emoji: '🛡️', title: '서비스 유형 삭제 보호',                 note: '시스템 관리자',                                         desc: '서비스 유형(카테고리)을 삭제하려 할 때 해당 카테고리를 사용하는 티켓이 있으면 삭제가 자동 차단됩니다. 목록에서 사용 중인 티켓 수가 뱃지(🎫 N건 사용 중)로 표시되며 삭제 버튼이 비활성화됩니다. 티켓이 없는 경우에만 삭제 가능하며, 운영 중에는 "비활성화"를 사용하는 것이 권장됩니다.', isNew: true },
]

/* ─── 보안 기능 데이터 ────────────────────────────────────────────────── */

const SECURITY_FEATURES: { emoji: string; title: string; desc: string; isNew?: boolean }[] = [
  { emoji: '🛡️', title: '감사 로그 Immutable (변경 불가)',      desc: 'PostgreSQL 트리거(audit_logs_no_update, audit_logs_no_delete)로 audit_logs 테이블에 대한 UPDATE/DELETE를 영구 차단합니다. 한 번 기록된 감사 이벤트는 절대 수정되거나 삭제될 수 없어 규정 준수(Compliance)를 보장합니다.', isNew: true },
  { emoji: '🖼️', title: '이미지 EXIF 메타데이터 자동 제거',     desc: '업로드된 이미지(JPEG/PNG/WebP)에서 GPS 위치·기기 정보·작성자 등 개인 식별 EXIF 메타데이터를 Pillow 라이브러리로 자동 제거합니다. PDF 등 지원 외 형식은 그대로 통과합니다.', isNew: true },
  { emoji: '🔍', title: '비밀 스캐닝 (Secret Detection)',        desc: '티켓·댓글 제출 시 AWS Access Key, GitLab PAT, OpenAI API Key, RSA Private Key, DB 비밀번호 등 9개 패턴을 정규식으로 자동 탐지합니다. 탐지 시 경고 로그 기록과 마스킹 처리가 되며, 차단하지 않는 fail-soft 방식으로 동작합니다.', isNew: true },
  { emoji: '🔐', title: '세션 최대 동시 접속 제한',              desc: 'MAX_ACTIVE_SESSIONS=5 환경변수로 계정당 동시 활성 세션 수를 제한합니다. 한도 초과 시 가장 오래된 세션이 자동으로 폐기(무효화)됩니다. Admin UI에서 특정 사용자의 세션 목록 조회 및 강제 종료가 가능합니다.', isNew: true },
  { emoji: '🦠', title: 'ClamAV 바이러스 스캔',                  desc: '파일 업로드 시 ClamAV 엔진으로 바이러스/악성코드를 실시간 스캔합니다. ARM64 환경에서는 linux/amd64 에뮬레이션으로 동작합니다. CLAMAV_ENABLED=false 환경변수로 비활성화 가능합니다.', isNew: true },
  { emoji: '🔑', title: 'JWT Refresh Token + Token Rotation',    desc: 'Access Token(2시간) + Refresh Token(30일) 이중 인증 구조입니다. Refresh Token 사용 시 새 토큰으로 교체(Rotation)되어 탈취된 토큰 재사용을 방지합니다.' },
  { emoji: '🔒', title: 'CSP / HSTS 보안 헤더',                  desc: 'Nginx에서 Content-Security-Policy, Strict-Transport-Security(max-age=31536000), X-Frame-Options: DENY, X-Content-Type-Options: nosniff 헤더를 자동 설정합니다.' },
  { emoji: '⚡', title: 'Rate Limiting (엔드포인트별)',           desc: 'slowapi로 엔드포인트별 Rate Limit을 적용합니다. 포털 제출 5건/분, 티켓 생성 10건/분 등 서비스별로 세분화됩니다.' },
  { emoji: '🦊', title: 'GitLab OAuth SSO',                       desc: '모든 인증은 GitLab OAuth 2.0 Authorization Code Flow를 통합니다. 별도 비밀번호 관리 없이 GitLab 계정으로 로그인합니다.' },
  { emoji: '📏', title: 'API 입력 길이 검증 (Pydantic)',          desc: '모든 API 입력값에 최대 길이 제한이 적용됩니다. 필터 이름 200자, 빠른 답변 내용 5,000자, 개발 전달 메모 2,000자 등 필드별 Pydantic Field(max_length=N) 검증으로 과도하게 큰 입력이 API 레벨에서 422로 즉시 거부됩니다.', isNew: true },
  { emoji: '🔇', title: 'ClamAV 내부 오류 정보 차단',             desc: '파일에서 악성코드가 탐지된 경우 ClamAV 엔진의 내부 응답(바이러스 시그니처 명 등 상세 정보)이 API 에러 메시지에 포함되지 않습니다. 공격자가 스캐너 버전·패턴 정보를 수집하는 것을 방지합니다.', isNew: true },
]

/* ─── 워크플로우 & SLA 데이터 ────────────────────────────────────────── */

const SLA_ROWS = [
  { priority: '긴급', emoji: '🔴', response: 4,  resolve: 8,   desc: '업무 불가 / 즉시 조치 필요',  color: 'text-red-600 bg-red-50',     example: '서버 다운, 전체 인터넷 불통' },
  { priority: '높음', emoji: '🟠', response: 8,  resolve: 24,  desc: '업무에 지장 있음',              color: 'text-orange-600 bg-orange-50', example: '주요 업무시스템 오류' },
  { priority: '보통', emoji: '🟡', response: 24, resolve: 72,  desc: '불편하지만 업무 가능',          color: 'text-yellow-700 bg-yellow-50', example: '업무 속도 저하, 일부 기능 이상' },
  { priority: '낮음', emoji: '⚪', response: 48, resolve: 168, desc: '일상 업무에 영향 없음',         color: 'text-gray-600 bg-gray-50',    example: '장비 교체 요청, 비업무 시간 대응' },
]

const WORKFLOW_NODES = [
  { id: 'open',              label: '접수됨',       emoji: '📥', color: 'bg-yellow-50 border-yellow-400 text-yellow-800',  note: null },
  { id: 'approved',          label: '승인완료',     emoji: '✅', color: 'bg-teal-50 border-teal-400 text-teal-800',         note: null },
  { id: 'in_progress',       label: '처리중',       emoji: '⚙️', color: 'bg-blue-50 border-blue-400 text-blue-800',        note: null },
  { id: 'waiting',           label: '대기중',       emoji: '⏳', color: 'bg-purple-50 border-purple-400 text-purple-800',  note: 'SLA 일시정지' },
  { id: 'resolved',          label: '처리완료',     emoji: '🔧', color: 'bg-green-50 border-green-400 text-green-800',     note: null },
  { id: 'ready_for_release', label: '운영배포전',   emoji: '📦', color: 'bg-amber-50 border-amber-400 text-amber-800',     note: null },
  { id: 'released',          label: '운영반영완료', emoji: '🚀', color: 'bg-indigo-50 border-indigo-400 text-indigo-800',  note: null },
  { id: 'closed',            label: '종료',         emoji: '🔒', color: 'bg-slate-50 border-slate-400 text-slate-700',    note: null },
  { id: 'reopened',          label: '재개됨',       emoji: '🔄', color: 'bg-orange-50 border-orange-400 text-orange-800', note: '종료 후 재처리' },
]

const ESCALATION_ACTIONS = [
  { icon: '🔔', label: '알림 발송 (notify)',             desc: '담당자 및 관련 사용자에게 인앱·이메일·Telegram 알림을 즉시 발송합니다.' },
  { icon: '👤', label: '담당자 변경 (reassign)',          desc: '지정된 에이전트로 티켓 담당자를 자동으로 변경합니다.' },
  { icon: '⬆️', label: '우선순위 자동 상향 (upgrade_priority)', desc: '티켓 우선순위를 한 단계 자동 상향합니다 (예: 보통 → 높음).' },
]

/* ─── 권한 데이터 ─────────────────────────────────────────────────────── */

const PERMISSION_ROWS: { feature: string; user: string; dev: string; agent: string; admin: string; isNew?: boolean }[] = [
  { feature: '고객 포털 티켓 접수 (비로그인 가능)',      user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 생성',                               user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '본인 티켓 조회·댓글',                     user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '만족도 평가',                             user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '지식베이스 열람',                         user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '칸반 보드 조회',                          user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '칸반 드래그 전환 규칙 (상태 제한)',        user: '—',  dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '필터 저장 (즐겨찾기)',                    user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '글로벌 검색 (⌘K)',                        user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 구독 (Watcher)',                     user: '✅', dev: '✅', agent: '✅', admin: '✅' },
  { feature: 'KB 자동 추천',                            user: '✅', dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: 'Confidential 티켓 생성',                  user: '✅', dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '키보드 단축키',                           user: '✅', dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '공지사항 열람',                           user: '✅', dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '개인 알림 설정',                          user: '✅', dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '할당된 티켓 조회',                        user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 수정 (제목·내용·카테고리)',          user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 상태 변경',                          user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '내부 메모 작성',                          user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '개발 프로젝트 전달',                      user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '연관 티켓·시간 기록',                    user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: 'GitLab MR 연결 조회',                    user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '지식베이스 작성·편집',                   user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '빠른 답변 조회',                          user: '—',  dev: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 복제(Clone)',                        user: '—',  dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '타임라인 뷰 (댓글+감사로그 통합)',        user: '—',  dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '첨부파일 인라인 미리보기',                user: '✅', dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '해결 노트 작성',                          user: '—',  dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '전체 티켓 조회·신청자 필터',              user: '—',  dev: '—',  agent: '✅', admin: '✅' },
  { feature: '담당자 변경',                             user: '—',  dev: '—',  agent: '✅', admin: '✅' },
  { feature: '일괄 작업 (종료·배정·우선순위)',          user: '—',  dev: '—',  agent: '✅', admin: '✅' },
  { feature: '리포트 & 에이전트 성과',                 user: '—',  dev: '—',  agent: '✅', admin: '✅' },
  { feature: '감사 로그 열람',                          user: '—',  dev: '—',  agent: '✅', admin: '✅' },
  { feature: '빠른 답변 생성·수정·삭제',               user: '—',  dev: '—',  agent: '✅', admin: '✅' },
  { feature: 'CSV 내보내기 (티켓)',                     user: '—',  dev: '—',  agent: '✅', admin: '✅', isNew: true },
  { feature: '지식베이스 삭제',                         user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: '사용자 역할 관리',                        user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: 'SLA 정책 관리',                           user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: 'SLA 에스컬레이션 정책 관리',              user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: '이메일 템플릿 관리',                      user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: '서비스 유형 관리',                        user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: '자동 배정 규칙 관리',                    user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: '티켓 템플릿 관리',                        user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: '티켓 삭제',                               user: '—',  dev: '—',  agent: '—',  admin: '✅' },
  { feature: 'API 키 관리',                             user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '아웃바운드 웹훅 관리',                    user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '공지사항 관리',                           user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '세션 관리 (강제 종료)',                   user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: 'Sudo 모드 (관리자 재인증)',                user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '비즈니스 KPI 대시보드 (Grafana)',          user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: 'GitLab 라벨 동기화 관리',                  user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '서비스 유형 삭제 보호 (사용 현황 표시)',    user: '—',  dev: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '구독 중인 티켓 목록 조회 및 취소',          user: '✅', dev: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '해결 노트 → KB 아티클 변환',               user: '—',  dev: '—',  agent: '✅', admin: '✅', isNew: true },
]

/* ─── 비교 매트릭스 데이터 ───────────────────────────────────────────── */

const COMPARISON_SECTIONS: { category: string; rows: { feature: string; itsm: string; zammad: string; glpi: string; jira: string; sn: string; isNew?: boolean }[] }[] = [
  {
    category: '티켓 관리',
    rows: [
      { feature: '티켓 CRUD + 파일 첨부',                  itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '상태 워크플로우 (9단계)',                  itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '내부 메모 (비공개 댓글)',                  itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '연관 티켓 링크·시간 기록',                itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '일괄 작업 (종료·배정·우선순위)',          itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '칸반 보드 뷰',                            itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅' },
      { feature: '칸반 드래그 전환 규칙 강제',              itsm: '✅', zammad: '❌', glpi: '❌', jira: '⚠️', sn: '✅', isNew: true },
      { feature: '파일 매직바이트 검증',                    itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '서비스 유형 동적 관리 (DB)',              itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'Confidential 티켓 (GitLab)',              itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️', isNew: true },
      { feature: '티켓 복제(Clone)',                        itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
      { feature: '타임라인 통합 뷰 (댓글+감사+시스템)',    itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '이미지 라이트박스 + PDF 인라인 미리보기', itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '⚠️', sn: '✅', isNew: true },
      { feature: '해결 노트 구조화 기록',                   itsm: '✅', zammad: '⚠️', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
    ],
  },
  {
    category: 'SLA 관리',
    rows: [
      { feature: 'SLA 실시간 추적 + 배지',                  itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: 'SLA 위반 자동 경고',                      itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: 'SLA 1시간 전 사전 경고 알림',             itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'SLA 일시정지/재개 (waiting 연동)',        itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'SLA 정책 UI 관리 (DB화)',                 itsm: '✅', zammad: '⚠️', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: 'SLA 에스컬레이션 자동화',                 itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
    ],
  },
  {
    category: '지식베이스',
    rows: [
      { feature: 'KB 작성·공개·관리',                      itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '전문 검색 (PostgreSQL FTS)',              itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '태그 필터 (GIN 인덱스)',                  itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'KB 자동 추천 (티켓 등록 시)',             itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
    ],
  },
  {
    category: '검색 & 필터',
    rows: [
      { feature: '다중 조건 복합 필터',                     itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '필터 URL 동기화 (북마크)',                itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅' },
      { feature: '즐겨찾기 필터 저장',                     itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '✅' },
      { feature: '글로벌 전문 검색 (⌘K)',                   itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
    ],
  },
  {
    category: '자동화',
    rows: [
      { feature: '자동 담당자 배정 규칙',                   itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '티켓 템플릿',                             itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '빠른 답변 템플릿',                        itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '⚠️', sn: '✅' },
      { feature: '티켓 구독 (Watcher)',                     itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'IMAP 이메일 → 티켓 자동 변환',           itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '❌', sn: '✅' },
      { feature: 'MR 머지 → 티켓 자동 해결',               itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️' },
      { feature: '커밋 메시지 → 티켓 참조 자동화',         itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️' },
      { feature: 'CI 파이프라인 실패 → 티켓 알림',        itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️' },
      { feature: '고객 셀프서비스 포털 (비로그인)',         itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '❌', sn: '✅' },
      { feature: 'SLA 에스컬레이션 자동화',                itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '이메일 템플릿 커스터마이징',              itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'API 키 인증',                             itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '아웃바운드 웹훅 (Slack/Teams)',           itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '키보드 단축키',                           itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
    ],
  },
  {
    category: '보고서',
    rows: [
      { feature: '통계 대시보드 + 추이 그래프',            itsm: '✅', zammad: '⚠️', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: 'CSV 내보내기',                            itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '에이전트 성과 리포트',                   itsm: '✅', zammad: '❌', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '만족도 별점 통계',                       itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '티켓 CSV 필터 내보내기',                 itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
    ],
  },
  {
    category: '알림',
    rows: [
      { feature: '인앱 실시간 알림 (SSE + Redis)',          itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '이메일 알림',                             itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: 'Telegram 알림',                           itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '❌', sn: '❌' },
      { feature: 'SLA 1시간 전 사전 경고 알림',            itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '티켓 구독자(Watcher) 알림',              itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '공지사항/배너',                          itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '개인 알림 설정 (이벤트별 토글)',         itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
    ],
  },
  {
    category: '보안',
    rows: [
      { feature: 'GitLab OAuth SSO',                       itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '4단계 RBAC',                              itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '감사 로그 (Audit Log)',                   itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: 'Rate Limiting (엔드포인트별)',            itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'JWT Refresh Token 자동 갱신 + Rotation', itsm: '✅', zammad: 'N/A', glpi: 'N/A', jira: '✅', sn: '✅' },
      { feature: 'CSP / HSTS 보안 헤더',                   itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'Redis requirepass 인증',                  itsm: '✅', zammad: '⚠️', glpi: 'N/A', jira: '✅', sn: '✅' },
      { feature: '퇴사자 계정 자동 동기화',                itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: '감사 로그 Immutable (DB 트리거)',         itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
      { feature: '이미지 EXIF 메타데이터 제거',             itsm: '✅', zammad: '❌', glpi: '❌', jira: '⚠️', sn: '✅', isNew: true },
      { feature: '비밀 스캐닝 (9개 패턴)',                  itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
      { feature: '세션 동시 접속 제한 (MAX=5)',             itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: 'ClamAV 바이러스 스캔',                   itsm: '✅', zammad: '❌', glpi: '⚠️', jira: '❌', sn: '✅', isNew: true },
    ],
  },
  {
    category: '모니터링',
    rows: [
      { feature: 'Prometheus/Grafana 내장',                 itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
      { feature: 'SLA 대시보드 (Apdex 포함)',              itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: 'RED 메트릭 (Rate·Error·Duration)',       itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
      { feature: '에러 버짓 트래킹',                       itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
    ],
  },
  {
    category: 'GitLab 통합',
    rows: [
      { feature: 'GitLab OAuth 로그인',                    itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '❌' },
      { feature: '개발 이슈 자동 전달',                    itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️' },
      { feature: 'GitLab MR 연결 조회',                    itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '❌' },
      { feature: 'GitLab 웹훅 수신 (Issue·MR·Push·Pipeline)', itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'MR 머지 → 티켓 자동 해결',              itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️' },
      { feature: '커밋 Push → 티켓 자동 참조',            itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️' },
      { feature: '파이프라인 실패 → 티켓 알림',           itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '⚠️' },
      { feature: '외부 GitLab 이슈 → SLA/알림 생성',      itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '❌' },
      { feature: 'Confidential Issue 생성',                itsm: '✅', zammad: '❌', glpi: '❌', jira: '⚠️', sn: '❌', isNew: true },
    ],
  },
  {
    category: '인프라 & 운영',
    rows: [
      { feature: 'Docker Compose 배포',                    itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '❌' },
      { feature: 'Prometheus 메트릭 (/metrics)',            itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '✅' },
      { feature: 'Grafana 자동 프로비저닝 대시보드 4개',   itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
      { feature: 'ClamAV 바이러스 스캔 (상시)',            itsm: '✅', zammad: '❌', glpi: '⚠️', jira: '❌', sn: '✅', isNew: true },
      { feature: 'PostgreSQL 자동 백업',                   itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'GitLab CI/CD 파이프라인',                itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '✅' },
      { feature: 'Alembic 마이그레이션 (43단계)',          itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
    ],
  },
]

/* ─── API 데이터 ──────────────────────────────────────────────────────── */

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'

const API_GROUPS: {
  id: string; emoji: string; name: string; baseUrl: string;
  color: string; border: string; bg: string;
  endpoints: { method: HttpMethod; path: string; desc: string; isNew?: boolean }[]
}[] = [
  {
    id: 'auth', emoji: '🔐', name: '인증 (Auth)', baseUrl: '/auth',
    color: 'text-blue-700', border: 'border-blue-200', bg: 'bg-blue-50',
    endpoints: [
      { method: 'GET',  path: '/auth/me',      desc: '현재 로그인 사용자 정보 조회' },
      { method: 'GET',  path: '/auth/login',   desc: 'GitLab OAuth 인증 시작' },
      { method: 'GET',  path: '/auth/callback', desc: 'OAuth 콜백 처리 및 토큰 발급' },
      { method: 'POST', path: '/auth/refresh', desc: '액세스 토큰 갱신 (Refresh Token)' },
      { method: 'POST', path: '/auth/logout',  desc: '로그아웃 및 쿠키 제거' },
    ],
  },
  {
    id: 'tickets', emoji: '🎫', name: '티켓 (Tickets)', baseUrl: '/tickets',
    color: 'text-green-700', border: 'border-green-200', bg: 'bg-green-50',
    endpoints: [
      { method: 'GET',    path: '/tickets',                   desc: '목록 조회 (필터·페이지네이션)' },
      { method: 'POST',   path: '/tickets',                   desc: '티켓 생성 (confidential 체크박스 포함)' },
      { method: 'GET',    path: '/tickets/search',            desc: '전문 검색 (?q=키워드, 글로벌 ⌘K 검색 연동)' },
      { method: 'GET',    path: '/tickets/export/csv',        desc: '현재 필터 기준 CSV 다운로드 (agent 이상, UTF-8 BOM)', isNew: true },
      { method: 'GET',    path: '/tickets/{iid}',             desc: '상세 조회' },
      { method: 'PATCH',  path: '/tickets/{iid}',             desc: '수정 (상태·담당자·제목 등)' },
      { method: 'DELETE', path: '/tickets/{iid}',             desc: '삭제 (admin 전용)' },
      { method: 'POST',   path: '/tickets/{iid}/clone',       desc: '티켓 복제 (제목·카테고리·우선순위·본문 복사, related 링크 자동 연결)', isNew: true },
      { method: 'GET',    path: '/tickets/{iid}/comments',    desc: '댓글 목록' },
      { method: 'POST',   path: '/tickets/{iid}/comments',    desc: '댓글 작성 (내부 메모 포함)' },
      { method: 'POST',   path: '/tickets/{iid}/attachments', desc: '파일 첨부 업로드 (EXIF 자동 제거, ClamAV 스캔)' },
      { method: 'GET',    path: '/tickets/{iid}/links',       desc: '연관 티켓 목록' },
      { method: 'GET',    path: '/tickets/{iid}/linked-mrs',  desc: 'GitLab MR 연결 목록' },
      { method: 'GET',    path: '/tickets/{iid}/forwards',    desc: '개발 프로젝트 전달 이력' },
      { method: 'POST',   path: '/tickets/bulk',              desc: '일괄 작업 (종료·배정·우선순위)' },
      { method: 'GET',    path: '/tickets/{iid}/watchers',    desc: '구독자(Watcher) 목록 조회' },
      { method: 'POST',   path: '/tickets/{iid}/watch',       desc: '티켓 구독 (멱등: 중복 호출 무시)' },
      { method: 'DELETE', path: '/tickets/{iid}/watch',       desc: '티켓 구독 취소' },
    ],
  },
  {
    id: 'kb', emoji: '📚', name: '지식베이스 (KB)', baseUrl: '/kb',
    color: 'text-purple-700', border: 'border-purple-200', bg: 'bg-purple-50',
    endpoints: [
      { method: 'GET',    path: '/kb/articles',        desc: '목록 (FTS 전문 검색·태그 필터)' },
      { method: 'POST',   path: '/kb/articles',        desc: '아티클 생성 (developer 이상)' },
      { method: 'GET',    path: '/kb/articles/{slug}', desc: '아티클 상세 조회' },
      { method: 'PATCH',  path: '/kb/articles/{slug}', desc: '아티클 수정' },
      { method: 'DELETE', path: '/kb/articles/{slug}', desc: '아티클 삭제 (admin)' },
      { method: 'GET',    path: '/kb/suggest?q=',      desc: 'KB 자동 추천 (FTS 기반, 티켓 제목 6자+ 디바운스 300ms)', isNew: true },
    ],
  },
  {
    id: 'admin', emoji: '⚙️', name: '관리 (Admin)', baseUrl: '/admin',
    color: 'text-red-700', border: 'border-red-200', bg: 'bg-red-50',
    endpoints: [
      { method: 'GET',    path: '/admin/users',                      desc: '사용자 목록 조회' },
      { method: 'PATCH',  path: '/admin/users/{id}/role',            desc: '사용자 역할 변경' },
      { method: 'GET',    path: '/admin/service-types',              desc: '서비스 유형 목록 (공개)' },
      { method: 'POST',   path: '/admin/service-types',              desc: '서비스 유형 생성 (admin)' },
      { method: 'PATCH',  path: '/admin/service-types/{id}',         desc: '서비스 유형 수정 (admin)' },
      { method: 'DELETE', path: '/admin/service-types/{id}',         desc: '서비스 유형 삭제 (admin)' },
      { method: 'GET',    path: '/admin/sla-policies',               desc: 'SLA 정책 목록' },
      { method: 'PUT',    path: '/admin/sla-policies/{priority}',    desc: 'SLA 정책 수정' },
      { method: 'GET',    path: '/admin/escalation-policies',        desc: 'SLA 에스컬레이션 정책 목록' },
      { method: 'POST',   path: '/admin/escalation-policies',        desc: '에스컬레이션 정책 생성' },
      { method: 'DELETE', path: '/admin/escalation-policies/{id}',   desc: '에스컬레이션 정책 삭제' },
      { method: 'GET',    path: '/admin/email-templates',            desc: '이메일 템플릿 목록' },
      { method: 'PUT',    path: '/admin/email-templates/{event}',    desc: '이메일 템플릿 수정' },
      { method: 'POST',   path: '/admin/email-templates/{event}/preview', desc: '이메일 템플릿 미리보기 (Jinja2 렌더링)' },
      { method: 'GET',    path: '/admin/audit',                      desc: '감사 로그 조회 (필터·페이지네이션)' },
      { method: 'GET',    path: '/admin/audit/download',             desc: '감사 로그 CSV 다운로드' },
      { method: 'GET',    path: '/admin/assignment-rules',           desc: '자동 배정 규칙 목록' },
      { method: 'POST',   path: '/admin/assignment-rules',           desc: '자동 배정 규칙 생성' },
      { method: 'GET',    path: '/admin/templates',                  desc: '티켓 템플릿 목록' },
      { method: 'GET',    path: '/admin/api-keys',                   desc: 'API 키 목록 조회', isNew: true },
      { method: 'POST',   path: '/admin/api-keys',                   desc: 'API 키 생성 (스코프 지정)', isNew: true },
      { method: 'DELETE', path: '/admin/api-keys/{id}',              desc: 'API 키 삭제', isNew: true },
      { method: 'GET',    path: '/admin/outbound-webhooks',          desc: '아웃바운드 웹훅 목록', isNew: true },
      { method: 'POST',   path: '/admin/outbound-webhooks',          desc: '아웃바운드 웹훅 생성', isNew: true },
      { method: 'PUT',    path: '/admin/outbound-webhooks/{id}',     desc: '아웃바운드 웹훅 수정', isNew: true },
      { method: 'DELETE', path: '/admin/outbound-webhooks/{id}',     desc: '아웃바운드 웹훅 삭제', isNew: true },
      { method: 'POST',   path: '/admin/outbound-webhooks/{id}/test', desc: '아웃바운드 웹훅 테스트 발송', isNew: true },
      { method: 'GET',    path: '/admin/announcements',              desc: '공지사항 목록 (관리자)', isNew: true },
      { method: 'POST',   path: '/admin/announcements',              desc: '공지사항 생성', isNew: true },
      { method: 'PUT',    path: '/admin/announcements/{id}',         desc: '공지사항 수정', isNew: true },
      { method: 'DELETE', path: '/admin/announcements/{id}',         desc: '공지사항 삭제', isNew: true },
      { method: 'GET',    path: '/admin/sessions/{user_id}',         desc: '특정 사용자 세션 목록', isNew: true },
      { method: 'DELETE', path: '/admin/sessions/{id}',              desc: '세션 강제 종료', isNew: true },
      { method: 'GET',    path: '/admin/label-status',               desc: 'GitLab 라벨 동기화 현황 조회 (프로젝트·그룹별)', isNew: true },
      { method: 'POST',   path: '/admin/sync-labels',                desc: '모든 필수 라벨 GitLab 강제 동기화', isNew: true },
      { method: 'GET',    path: '/admin/service-types/usage',        desc: '서비스 유형별 사용 중인 티켓 수 조회', isNew: true },
    ],
  },
  {
    id: 'reports', emoji: '📊', name: '보고서 (Reports)', baseUrl: '/reports',
    color: 'text-orange-700', border: 'border-orange-200', bg: 'bg-orange-50',
    endpoints: [
      { method: 'GET', path: '/reports/stats',             desc: '전체 통계 (신규·종료·SLA·만족도)' },
      { method: 'GET', path: '/reports/sla',               desc: 'SLA 현황 및 위반 현황' },
      { method: 'GET', path: '/reports/ratings',           desc: '만족도 별점 통계' },
      { method: 'GET', path: '/reports/agent-performance', desc: '에이전트별 성과 (처리 건수·SLA·평점)' },
      { method: 'GET', path: '/reports/export',            desc: '보고서 CSV 내보내기' },
    ],
  },
  {
    id: 'filters', emoji: '🔖', name: '필터 (Filters)', baseUrl: '/filters',
    color: 'text-teal-700', border: 'border-teal-200', bg: 'bg-teal-50',
    endpoints: [
      { method: 'GET',    path: '/filters',      desc: '저장된 즐겨찾기 필터 목록' },
      { method: 'POST',   path: '/filters',      desc: '필터 저장' },
      { method: 'DELETE', path: '/filters/{id}', desc: '필터 삭제' },
    ],
  },
  {
    id: 'notifications', emoji: '🔔', name: '알림 (Notifications)', baseUrl: '/notifications',
    color: 'text-yellow-700', border: 'border-yellow-200', bg: 'bg-yellow-50',
    endpoints: [
      { method: 'GET',   path: '/notifications',              desc: '알림 목록 조회' },
      { method: 'PATCH', path: '/notifications/{id}/read',    desc: '알림 읽음 처리' },
      { method: 'GET',   path: '/notifications/stream',       desc: 'SSE 실시간 알림 스트림' },
      { method: 'GET',   path: '/notifications/prefs',        desc: '개인 알림 설정 조회', isNew: true },
      { method: 'PUT',   path: '/notifications/prefs',        desc: '개인 알림 설정 변경 (이벤트별 이메일/인앱 토글)', isNew: true },
      { method: 'GET',   path: '/notifications/announcements', desc: '공지사항 조회 (로그인 사용자)', isNew: true },
      { method: 'GET',   path: '/notifications/my-watches',   desc: '내가 구독 중인 티켓 목록 (티켓 상세 정보 포함)', isNew: true },
      { method: 'PATCH', path: '/notifications/read-all',     desc: '모든 알림 읽음 처리', isNew: true },
    ],
  },
  {
    id: 'quick-replies', emoji: '💬', name: '빠른 답변 (Quick Replies)', baseUrl: '/quick-replies',
    color: 'text-pink-700', border: 'border-pink-200', bg: 'bg-pink-50',
    endpoints: [
      { method: 'GET',    path: '/quick-replies',      desc: '목록 조회 (developer 이상)' },
      { method: 'POST',   path: '/quick-replies',      desc: '생성 (agent 이상)' },
      { method: 'PUT',    path: '/quick-replies/{id}', desc: '수정 (agent 이상)' },
      { method: 'DELETE', path: '/quick-replies/{id}', desc: '삭제 (agent 이상)' },
    ],
  },
  {
    id: 'portal', emoji: '🌐', name: '고객 포털 (Portal)', baseUrl: '/portal',
    color: 'text-teal-700', border: 'border-teal-200', bg: 'bg-teal-50',
    endpoints: [
      { method: 'POST', path: '/portal/submit',        desc: '비로그인 티켓 제출 (이름·이메일·제목·내용·카테고리·긴급도) — Rate Limit 5/분' },
      { method: 'GET',  path: '/portal/track/{token}', desc: '게스트 토큰으로 티켓 상태 조회 (인증 불필요)' },
    ],
  },
]

const METHOD_BADGE: Record<HttpMethod, string> = {
  GET:    'bg-green-100 text-green-800 border border-green-300',
  POST:   'bg-blue-100 text-blue-800 border border-blue-300',
  PATCH:  'bg-yellow-100 text-yellow-800 border border-yellow-300',
  PUT:    'bg-yellow-100 text-yellow-800 border border-yellow-300',
  DELETE: 'bg-red-100 text-red-800 border border-red-300',
}

/* ─── 아키텍처 데이터 ─────────────────────────────────────────────────── */

const SW_COMPONENTS = [
  {
    emoji: '🔀', name: 'Nginx', version: '1.27',
    category: '네트워크', badge: 'bg-green-100 text-green-800',
    border: 'border-green-300', bg: 'bg-green-50',
    role: '리버스 프록시 · 단일 진입점',
    desc: '외부의 모든 요청을 포트 8111 하나로 받아 Next.js(웹)와 FastAPI(API)로 분기합니다. SSE 알림 스트림 경로에 proxy_buffering off를 적용하여 실시간 이벤트가 끊기지 않게 합니다.',
    details: [
      '포트 8111 → / 경로: Next.js :3000 프록시',
      '/api/ 경로: FastAPI :8000 프록시',
      '/api/notifications/stream: proxy_buffering off, proxy_read_timeout 86400s',
      'gzip on: application/json 압축 (응답 크기 ~90% 감소, 53KB → 5KB)',
      'gzip_comp_level=4, gzip_min_length=1024, gzip_proxied any',
      'Content-Security-Policy (CSP) 헤더: default-src self, img-src data/blob 허용',
      'Strict-Transport-Security (HSTS): max-age=31536000; includeSubDomains',
      'X-Frame-Options: DENY, X-Content-Type-Options: nosniff',
    ],
  },
  {
    emoji: '⚛️', name: 'Next.js 15', version: 'App Router · React 18 · TypeScript · Node.js 22',
    category: '프론트엔드', badge: 'bg-blue-100 text-blue-800',
    border: 'border-blue-300', bg: 'bg-blue-50',
    role: '웹 프론트엔드 클라이언트',
    desc: 'App Router 기반의 React 18 웹 클라이언트로, Tailwind CSS로 스타일링합니다. standalone 빌드로 Docker 이미지 크기를 최소화하고, EventSource API로 SSE 알림을 실시간 수신합니다.',
    details: [
      'TypeScript + React 18 (서버·클라이언트 컴포넌트)',
      'Tailwind CSS (유틸리티 우선 스타일링)',
      '@hello-pangea/dnd (칸반 드래그앤드롭)',
      'TipTap 2.x: WYSIWYG 리치 텍스트 에디터 (Bold/Italic/코드블록/표/이미지)',
      'GlobalSearch 컴포넌트: ⌘K/Ctrl+K 단축키, 300ms 디바운스, 화살표 키 탐색',
      '키보드 단축키: g+t/k/b/r/a, n(새 티켓), ?(도움말)',
      'next.config.js output: standalone (경량 Docker 이미지)',
      'EventSource로 SSE 실시간 알림 수신',
      '모바일 반응형: 햄버거 메뉴 (< md), 터치 영역 최소 44px (WCAG 2.5.5)',
      'Next.js 15.5.x (최신 안정 버전)',
    ],
  },
  {
    emoji: '⚡', name: 'FastAPI', version: 'Python 3.13 · Uvicorn ASGI',
    category: '백엔드 API', badge: 'bg-yellow-100 text-yellow-800',
    border: 'border-yellow-300', bg: 'bg-yellow-50',
    role: 'REST API 서버 · 비즈니스 로직',
    desc: 'ITSM의 핵심 비즈니스 로직을 처리하는 비동기 API 서버입니다. SLA 체커·스냅샷 스케줄러·사용자 동기화가 백그라운드 스레드로 동작하고, slowapi로 Rate Limiting, prometheus-fastapi-instrumentator로 메트릭을 제공합니다.',
    details: [
      'SQLAlchemy 2.0 ORM + Alembic 마이그레이션 (0001~0043, 43단계)',
      'slowapi Rate Limiting (포털 5/분·티켓 생성 10/분 등 엔드포인트별 세분화)',
      'prometheus-fastapi-instrumentator → /metrics 노출',
      '비즈니스 KPI 메트릭 27종 (5분 주기 DB 집계, 별도 스레드)',
      'python-magic 파일 매직바이트 검증 (최대 10MB)',
      'Pillow EXIF 자동 제거 (JPEG/PNG/WebP)',
      '비밀 스캐닝: 9개 패턴 정규식 (AWS Key/GitLab PAT/OpenAI Key 등)',
      'SLA 체커 스레드 (5분 주기): 에스컬레이션 정책 실행 포함',
      '사용자 동기화 스레드 (USER_SYNC_INTERVAL, 기본 1시간): GitLab 그룹 멤버십 → is_active 동기화',
      '스냅샷 스케줄러 스레드 (자정 1회)',
      'IMAP 이메일 수집 스레드 (IMAP_ENABLED=true 시, IMAP_POLL_INTERVAL 간격)',
      'JWT Access(2h) + Refresh Token(30일) 이중 인증 + Token Rotation',
      'Jinja2 이메일 템플릿 렌더링: DB 우선, 없으면 하드코딩 폴백',
      'MAX_ACTIVE_SESSIONS=5: 세션 초과 시 오래된 세션 자동 폐기',
      'httpx 공유 커넥션 풀 (max_connections=30): GitLab API 요청 TCP 재사용',
      'label_sync 쿨다운 5분: 30초 주기 Prometheus 스크레이프 시 GitLab API 과호출 방지',
      'non-root 컨테이너 실행 (appuser): Dockerfile에 useradd로 전용 사용자 생성 후 USER 전환',
    ],
  },
  {
    emoji: '🐘', name: 'PostgreSQL 17', version: '17',
    category: '데이터베이스', badge: 'bg-indigo-100 text-indigo-800',
    border: 'border-indigo-300', bg: 'bg-indigo-50',
    role: '주 관계형 데이터베이스',
    desc: '티켓·사용자·SLA·KB·감사로그 등 모든 데이터를 저장합니다. KB 전문 검색에 GIN 인덱스(tsvector), 태그 필터에 ARRAY+GIN, 즐겨찾기 필터에 JSONB를 활용하여 고성능 검색을 구현합니다.',
    details: [
      'Alembic 마이그레이션 43단계 (0001~0043)',
      'GIN 인덱스: KB FTS (tsvector), 태그 (TEXT[] ARRAY)',
      'JSONB: saved_filters.filters 컬럼',
      'UserRole.is_active 컬럼: 퇴사자 계정 비활성화 플래그',
      'EscalationPolicy, EscalationRecord 테이블: SLA 에스컬레이션 정책 관리',
      'EmailTemplate 테이블: 이벤트별 Jinja2 이메일 템플릿',
      'audit_logs_no_update / audit_logs_no_delete 트리거 (Immutable 감사로그)',
      'ApiKey 테이블: SHA-256 해시 저장 (평문 미보관)',
      'OutboundWebhook 테이블: Slack/Teams 웹훅 설정',
      'Announcement 테이블: 공지사항 관리',
      'SudoToken 테이블: 관리자 재인증 토큰 (15분 유효)',
      'ResolutionNote 테이블: 티켓 해결 노트 구조화 저장',
      'VACUUM ANALYZE 정기 실행 권장 (Dead tuple 정리)',
      '중복 인덱스 제거 (0041): 스토리지·쓰기 성능 개선',
      'daily_stats_snapshots 유니크 인덱스 (0042)',
      'refresh_tokens·ticket_links·time_entries 복합 인덱스 (0043)',
      'pg_isready 헬스체크 (10초 간격)',
      '24시간 pg_dump 자동 백업 → /backups/*.sql.gz',
    ],
  },
  {
    emoji: '🔴', name: 'Redis 7.4', version: '7.4',
    category: '캐시 · Pub/Sub', badge: 'bg-red-100 text-red-800',
    border: 'border-red-300', bg: 'bg-red-50',
    role: 'SSE 알림 Pub/Sub · 웹훅 중복 방지',
    desc: '인앱 실시간 알림의 발행-구독 브로커입니다. API 서버 여러 인스턴스가 동일 Redis 채널을 통해 알림 이벤트를 공유하고, 웹훅 UUID를 5분 TTL로 저장하여 재전송 공격을 방지합니다.',
    details: [
      'SSE 알림 pub/sub 채널 브로커',
      '웹훅 X-Gitlab-Event-UUID 중복 감지 (TTL 5분)',
      'IMAP 이메일 Message-ID 중복 방지 SET (TTL 30일)',
      'requirepass 인증 (REDIS_PASSWORD 환경변수)',
      'maxmemory 256mb + allkeys-lru 정책 (메모리 무제한 성장 방지)',
      '포트 6379 (Docker 내부 네트워크)',
      '영속성 볼륨: itsm_redis (appendonly yes)',
    ],
  },
  {
    emoji: '🦊', name: 'GitLab CE', version: 'CE latest',
    category: '인증 · VCS', badge: 'bg-orange-100 text-orange-800',
    border: 'border-orange-300', bg: 'bg-orange-50',
    role: 'OAuth 2.0 SSO · 이슈·MR 관리',
    desc: 'ITSM의 유일한 인증 제공자입니다. Authorization Code Flow로 로그인하고, GitLab API로 이슈 생성·MR 조회·사용자 상태 확인을 수행합니다. 그룹 멤버십은 1시간 주기로 동기화되어 퇴사자 계정을 자동 차단합니다.',
    details: [
      'OAuth 2.0 Authorization Code Flow (로그인·토큰 발급)',
      'GitLab API: 이슈 생성, MR 조회, 사용자 상태 확인, 그룹 멤버 목록 조회',
      '글로벌 검색: GitLab Projects Search API 연동 (GET /tickets/search)',
      '웹훅 발신: Push·MR·이슈·Pipeline 이벤트 → itsm-api /webhooks',
      'Push Hook: 커밋 메시지 #N 참조 → 자동 코멘트',
      'Pipeline Hook: 파이프라인 실패 → 티켓 자동 알림',
      'MR Hook: 머지 시 Closes/Fixes #N → 티켓 자동 해결',
      '포트 8929(HTTP), 2224(SSH)',
      'X-Gitlab-Token 헤더로 웹훅 수신 검증',
      'Confidential Issue 생성 지원 (confidential=true)',
    ],
  },
  {
    emoji: '📊', name: 'Prometheus', version: 'latest',
    category: '모니터링 (상시)', badge: 'bg-orange-100 text-orange-700',
    border: 'border-orange-200', bg: 'bg-orange-50',
    role: '메트릭 수집 · 시계열 저장',
    desc: 'FastAPI /metrics 엔드포인트를 60초 간격으로 스크래핑하여 API 응답 시간·요청 수·에러율을 수집합니다. 30일 데이터를 보관하며, 별도 profile 없이 항상 기동됩니다.',
    details: [
      'scrape_interval: 60s (성능 최적화 — 이전 15s에서 변경)',
      'evaluation_interval: 60s',
      'tsdb 보관 기간: 30일',
      '포트 9090 (Grafana 데이터소스)',
      '항상 기동 (--profile 불필요)',
    ],
  },
  {
    emoji: '📈', name: 'Grafana', version: 'latest',
    category: '모니터링 (상시)', badge: 'bg-purple-100 text-purple-800',
    border: 'border-purple-300', bg: 'bg-purple-50',
    role: '메트릭 시각화 대시보드',
    desc: 'Prometheus를 데이터소스로 연결하여 API 성능·SLA 현황·비즈니스 KPI를 대시보드로 시각화합니다. 4개의 전용 대시보드가 자동 프로비저닝되며, 포트 3001로 접근합니다.',
    details: [
      'Prometheus 데이터소스 (포트 9090)',
      '포트 3001 (외부 접근용)',
      'GF_SECURITY_ADMIN_PASSWORD 환경변수',
      '대시보드 1: ITSM 운영 대시보드 (RED + 시스템 리소스, 엔드포인트별 통계)',
      '대시보드 2: ITSM 성능 분석 (P50/P90/P95/P99 레이턴시, 처리량)',
      '대시보드 3: ITSM SLA 모니터링 (가용성/Apdex/에러버짓/P95 SLO)',
      '대시보드 4: ITSM 메뉴별 운영 현황 (비즈니스 KPI 27종 — 티켓·KB·칸반·리포트·관리)',
      '자동 프로비저닝 (항상 기동)',
    ],
  },
  {
    emoji: '🦠', name: 'ClamAV', version: 'latest',
    category: '보안 스캔 (상시)', badge: 'bg-red-100 text-red-700',
    border: 'border-red-200', bg: 'bg-red-50',
    role: '바이러스·악성코드 실시간 스캔',
    desc: '파일 업로드 시 ClamAV 엔진으로 바이러스 및 악성코드를 실시간 스캔합니다. ARM64 환경에서는 linux/amd64 에뮬레이션으로 동작합니다. 항상 기동됩니다.',
    details: [
      '파일 업로드 시 실시간 바이러스 스캔',
      'ARM64: linux/amd64 에뮬레이션',
      'CLAMAV_ENABLED=false 환경변수로 비활성화 가능',
      '항상 기동 (--profile 불필요)',
    ],
  },
]

/* ─── 성능 & 안정화 데이터 ────────────────────────────────────────────── */

const PERF_IMPROVEMENTS = [
  {
    category: '🔴 프론트엔드 병목 제거',
    title: '초기 로드 워터폴 병렬화',
    before: '272ms (fetchProjects → stats → list_tickets 직렬)',
    after: '176ms (3개 요청 동시 시작)',
    saving: '약 96ms 단축 (35% 개선)',
    detail: 'fetchProjects 완료를 기다리지 않고 fetchStats·fetchSavedFilters·list_tickets를 동시에 시작. 단일 프로젝트 환경에서는 project_id="" 기본값으로 즉시 로드, 재로드 없음.',
  },
  {
    category: '🟠 백엔드 커넥션 풀',
    title: 'httpx 싱글톤 클라이언트',
    before: '매 GitLab API 호출마다 TCP 연결 신규 생성 (~3.2ms/회)',
    after: '공유 커넥션 풀 재사용 (TCP 핸드쉐이크 제거)',
    saving: '페이지 로드당 7~8회 × 3.2ms = ~22ms 절감',
    detail: 'with httpx.Client() as c 패턴을 모듈 레벨 싱글톤으로 교체. max_connections=30, keepalive=15, keepalive_expiry=60s. timeout != None 시에만 독립 클라이언트 사용(스레드 안전).',
  },
  {
    category: '🟡 캐시 효율 개선',
    title: 'TTL 연장 + 무효화 시 구 키 즉시 삭제',
    before: 'stats 60s TTL, requesters 300s TTL, 구 버전 키 TTL 만료까지 잔류',
    after: 'stats 300s / requesters 600s / list_tickets 180s TTL',
    saving: '캐시 미스 빈도 5배 감소, Redis 메모리 낭비 제거',
    detail: '캐시 무효화(티켓 생성·수정) 시 구 버전 키를 즉시 DEL. stats 캐시도 함께 무효화. 버전 기반 캐시 키로 티켓 변경 즉시 반영 보장.',
  },
  {
    category: '🟡 네트워크 압축',
    title: 'nginx gzip 압축',
    before: '티켓 목록 응답 53KB 비압축 전송',
    after: '5KB (90% 압축)',
    saving: '저대역폭·모바일 환경에서 응답 속도 대폭 향상',
    detail: 'gzip on, gzip_types application/json, gzip_min_length 1024, gzip_comp_level 4, gzip_proxied any. 1KB 미만 소형 응답은 압축 제외(CPU 낭비 방지).',
  },
  {
    category: '🔴 CPU 100% 수정',
    title: 'SSE 스트림 tight loop 제거',
    before: 'API CPU 100% 고착 (티켓 상세 페이지 오픈 시)',
    after: 'CPU 0.24% 안정 유지',
    saving: '상시 CPU 낭비 완전 제거',
    detail: 'pubsub.get_message()가 메시지 없을 때 즉시 None 반환 → asyncio.wait_for(timeout=30) 무효화 → while True 이벤트 루프 독점 발생. 수정: get_message(timeout=1.0)으로 1초 실제 블로킹 대기. 티켓 SSE·알림 SSE 양쪽 모두 수정.',
  },
  {
    category: '🟠 캐시 추가',
    title: '타임라인 Redis 캐시 60초',
    before: '타임라인 탭 클릭 시 매번 GitLab API 호출 (1.5~4초)',
    after: '캐시 히트 시 ~17ms',
    saving: '반복 접근 시 99% 응답 시간 단축',
    detail: 'get_notes() GitLab API 결과를 Redis에 60초 캐시. 캐시 키: itsm:timeline:{pid}:{iid}. 사용자 역할과 무관하게 동일 캐시 사용(공개 데이터). 댓글 등록 시 자동 무효화.',
  },
  {
    category: '🟠 캐시 추가',
    title: '서비스 유형 Usage API 캐시 5분',
    before: '서비스 유형 관리 페이지 진입 시 22초 지연 (GitLab API 5회 직렬)',
    after: '5분 캐시 히트 시 즉시 반환',
    saving: '관리 페이지 응답 22초 → 즉시',
    detail: '각 서비스 유형별 티켓 수를 GitLab API로 병렬 조회 후 Redis에 5분 캐시. itsm:admin:service_type_usage 키. 서비스 유형 추가·수정 시 캐시가 5분 후 자연 만료.',
  },
  {
    category: '🟡 모니터링 최적화',
    title: 'Prometheus scrape 간격 60초 + GitLab health 캐시',
    before: 'scrape 15초, /health 매번 GitLab API 호출(2~8초), Docker healthcheck 30초',
    after: 'scrape 60초, /health GitLab 캐시 60초, Docker healthcheck 60초',
    saving: '/health 2~8초 → 3ms, Prometheus 부하 4배 감소',
    detail: 'Prometheus scrape_interval 15s→60s. /health GitLab /api/v4/version 호출 결과 60초 in-memory 캐시. Docker healthcheck interval 30s→60s. 모두 캐시 60s > healthcheck 30s 보장.',
  },
]

const STABILITY_FIXES = [
  {
    emoji: '🔴',
    title: 'GitLab 레이블 드리프트 루프 수정',
    severity: '심각',
    symptom: '30초마다 "Label drift detected" 경고 반복 → GitLab API 과호출',
    cause: 'corrupt 레이블 4개 존재 (cat::1, prio::PriorityEnum.MEDIUM 등) + _fetch_existing_labels()가 include_ancestor_groups 없이 조회',
    fix: 'corrupt 레이블 삭제·정규 레이블 13개 재등록 / _check_label_drift()에 5분 쿨다운 추가 / include_ancestor_groups=true로 조회 개선',
  },
  {
    emoji: '🟠',
    title: 'httpx 타임아웃 경합 조건 수정',
    severity: '중간',
    symptom: '멀티스레드 환경에서 timeout 설정 경합 → 요청 실패 가능성',
    cause: '공유 클라이언트의 timeout 속성을 여러 스레드가 동시에 수정',
    fix: 'timeout != None 시 독립 클라이언트 사용, timeout=None 시만 공유 풀 재사용',
  },
  {
    emoji: '🟡',
    title: '중복 DB 인덱스 제거 (migration 0041)',
    severity: '낮음',
    symptom: '19개 테이블에 pkey와 동일 컬럼 ix_xxx_id 중복 인덱스 존재',
    cause: '여러 Alembic 마이그레이션 버전에 걸쳐 누적',
    fix: '0041 마이그레이션으로 중복 인덱스 17개 삭제 (스토리지·INSERT/UPDATE 성능 개선)',
  },
  {
    emoji: '🟡',
    title: 'Dead tuple 정리 (VACUUM ANALYZE)',
    severity: '낮음',
    symptom: '일부 테이블 dead_pct > 100% (alembic_version 4100%, user_roles 270%)',
    cause: '잦은 UPDATE/DELETE 후 자동 VACUUM 미실행',
    fix: 'VACUUM ANALYZE 전체 실행 후 dead tuple 0건 확인',
  },
  {
    emoji: '🟠',
    title: 'Redis 연결 풀 누수 수정 (타임라인)',
    severity: '중간',
    symptom: '타임라인 탭 반복 클릭 시 Redis 연결 수 무한 증가 → 연결 거부 가능성',
    cause: 'get_timeline() 함수에서 redis.from_url()로 요청마다 신규 연결 풀 생성 — 싱글턴 _get_redis() 미사용',
    fix: 'from_url() 제거, _get_redis() 싱글턴 풀 재사용으로 교체. 연결 수 일정 유지.',
  },
  {
    emoji: '🟢',
    title: 'SSE 연결 끊김 nginx 에러 로그',
    severity: '정보',
    symptom: '"upstream prematurely closed connection" 반복 로그',
    cause: '브라우저 탭 닫을 때 SSE 연결이 끊기는 정상 동작',
    fix: '실제 장애 아님 — 클라이언트 disconnect 정상 현상으로 확인',
  },
  {
    emoji: '🟠',
    title: 'nginx DNS 캐시로 재빌드 후 502 발생',
    severity: '중간',
    symptom: 'itsm-api·itsm-web 재빌드 후 /api/* 엔드포인트 전체 502 Bad Gateway',
    cause: 'nginx가 upstream IP를 시작 시 한 번만 DNS 조회(캐싱). 컨테이너 재빌드 시 Docker가 새 IP를 할당하면 nginx는 구 IP로 계속 접속 시도 → Connection refused',
    fix: '`docker exec itsm-nginx-1 nginx -s reload` 실행으로 DNS 재조회. 컨테이너 재빌드 후 nginx reload를 배포 절차에 포함.',
  },
  {
    emoji: '🟢',
    title: 'approved·ready_for_release·released 상태 정식 추가',
    severity: '개선',
    symptom: '인접 상태로 대체 운영 — approved는 in_progress, ready_for_release·released는 resolved·댓글로 표현',
    cause: 'StatusEnum·VALID_TRANSITIONS·GitLab 라벨·프론트 컴포넌트 전반에 걸쳐 3개 상태 미정의',
    fix: 'schemas.py StatusEnum 확장, tickets.py VALID_TRANSITIONS 재설계(9상태), gitlab_client.py REQUIRED_LABELS·_LABEL_DISPLAY 추가, notifications.py status_map 추가, admin.py filter-options 추가, forwards.py _STATUS_RANK·_FORWARD_TO_ITSM 추가. 프론트: constants.ts·StatusBadge·Kanban(8열)·WorkflowStepper(7단계)·홈 statTabs(9탭) 전부 업데이트.',
  },
  {
    emoji: '🔴',
    title: '티켓 목록 카테고리 필터 동작 안함 수정',
    severity: '심각',
    symptom: '카테고리 드롭다운 선택 시 결과 0건 반환, 기타 선택 시 항상 0건',
    cause: '① 프론트: option value로 숫자("1","2") 전송 → 백엔드 cat::1 검색(GitLab 라벨 없음). ② 기타(other): cat::other 라벨 없는 티켓 33건이 필터에서 누락',
    fix: '① option value를 t.description("hardware","software")으로 수정. ② other 선택 시 알려진 카테고리를 not_labels로 제외하는 방식으로 전환. ServiceTypesContext: value/label/description 3가지 모두 조회 가능하도록 개선.',
  },
  {
    emoji: '🟠',
    title: 'KB 카테고리 카운트/필터 오작동 수정',
    severity: '높음',
    symptom: 'KB 카테고리 카드 모두 0개, 카테고리 필터 결과 없음',
    cause: 'service_type.value("1")와 KB article.category("하드웨어") 불일치. 한 아티클에 category="2" 이상 데이터 존재',
    fix: 'ServiceTypesContext getLabel/getEmoji를 value·label·description 모두로 조회. KB 목록: 카운트·필터를 c.label 기준으로 전환. DB: category="2" → "소프트웨어" 정정.',
  },
  {
    emoji: '🟠',
    title: 'SLA 정책 음수·0 값 저장 허용 수정',
    severity: '높음',
    symptom: 'SLA 응답/해결 시간에 음수(-1) 또는 0 시간 저장 가능 → 모든 티켓 즉시 SLA 위반 처리',
    cause: 'SLAPolicyUpdate 모델에 ge=1 검증 없음',
    fix: 'response_hours, resolve_hours 필드에 ge=1 최솟값 검증 추가. API 호출 시 422 Unprocessable Entity 반환.',
  },
  {
    emoji: '🟡',
    title: '이메일 미리보기 XSS(Stored) 수정',
    severity: '중간',
    symptom: '이메일 템플릿 편집 시 <script> 태그 저장 후 미리보기 클릭 시 관리자 브라우저에서 스크립트 실행',
    cause: 'dangerouslySetInnerHTML={{ __html: preview.html_body }} 사용으로 HTML 그대로 렌더링',
    fix: 'sandbox iframe(allow-same-origin)으로 교체. script 실행 완전 차단. 자동 높이 조절 onLoad 핸들러 추가.',
  },
  {
    emoji: '🟡',
    title: '리포트 날짜 필터 버그 2종 수정',
    severity: '높음',
    symptom: '① 역방향 날짜(from>to) 시 에러 없이 잘못된 데이터 반환. ② open/in_progress/resolved 수치가 날짜 범위 무시하고 현재 상태 반환',
    cause: '① from_date > to_date 검증 없음. ② _count_open/in_progress/resolved 함수에 created_after/before 파라미터 미전달',
    fix: '① from>to 시 HTTP 400. ② 세 함수에 created_after/before 추가하여 기간 내 생성 티켓 기준으로 집계. PriorityEnum.X corrupt 키 정규화, 카테고리 키 한국어 통일.',
  },
  {
    emoji: '🟢',
    title: '감사 로그 행위자 검색 서버사이드 전환',
    severity: '낮음',
    symptom: '행위자 검색 시 현재 페이지 50건만 필터링 → "X건 (전체 N건)" 오해 유발',
    cause: 'actorSearch가 fetchAuditLogs 의존성에 없어 서버 재조회 없음 + 클라이언트 필터',
    fix: '백엔드 actor_username ILIKE 파라미터 추가. 프론트 fetchAuditLogs에 actor_username 전달 및 deps 추가. 클라이언트 필터 로직 제거.',
  },
]

const CONNECTIONS = [
  { from: '사용자 브라우저',         to: 'Nginx',                  protocol: 'HTTP',           port: ':8111',      direction: '→', detail: '단일 외부 진입점. 모든 요청이 이 포트를 통해 유입됩니다.', color: 'bg-gray-50' },
  { from: 'Nginx',                    to: 'itsm-web (Next.js)',      protocol: 'HTTP',           port: ':3000',      direction: '→', detail: '/ 경로 → Next.js 웹 서버로 프록시. 웹소켓 Upgrade 헤더 전달 포함.', color: 'bg-blue-50' },
  { from: 'Nginx',                    to: 'itsm-api (FastAPI)',      protocol: 'HTTP / SSE',     port: ':8000',      direction: '→', detail: '/api/ 경로 → FastAPI 서버. /api/notifications/stream 경로는 proxy_buffering off 적용.', color: 'bg-yellow-50' },
  { from: 'itsm-web',                 to: 'itsm-api',               protocol: 'HTTP REST + SSE', port: ':8111 경유', direction: '→', detail: 'API 데이터 요청(fetch) 및 EventSource로 SSE 알림 스트림 연결. JWT 쿠키 자동 포함.', color: 'bg-blue-50' },
  { from: 'itsm-api',                 to: 'PostgreSQL',             protocol: 'TCP',            port: ':5432',      direction: '→', detail: 'SQLAlchemy ORM으로 모든 데이터 CRUD. 시작 시 alembic upgrade head 자동 마이그레이션.', color: 'bg-indigo-50' },
  { from: 'itsm-api',                 to: 'Redis',                  protocol: 'TCP',            port: ':6379',      direction: '→', detail: 'SSE 알림 이벤트 pub/sub 발행. 웹훅 UUID 중복 감지를 위한 SET 저장 (TTL 5분).', color: 'bg-red-50' },
  { from: 'itsm-api',                 to: 'GitLab API',             protocol: 'HTTP',           port: ':8929',      direction: '→', detail: 'OAuth 토큰 검증, 이슈 생성 (개발 전달), MR·이슈 조회, 그룹 멤버 목록 (사용자 동기화), 티켓 검색.', color: 'bg-orange-50' },
  { from: 'itsm-api',                 to: 'ClamAV',                 protocol: 'TCP',            port: ':3310',      direction: '→', detail: '파일 업로드 시 ClamAV 데몬으로 바이러스 스캔 요청.', color: 'bg-red-50' },
  { from: 'GitLab',                   to: 'itsm-api',               protocol: 'HTTP POST',      port: ':8000/webhooks', direction: '←', detail: 'Push·MR·이슈 이벤트 웹훅 수신. X-Gitlab-Token 헤더로 검증. UUID 중복 방지.', color: 'bg-orange-50' },
  { from: 'Redis',                    to: 'itsm-api (SSE 구독)',    protocol: 'TCP',            port: ':6379',      direction: '←', detail: '알림 발행 시 구독 중인 SSE 핸들러로 이벤트 전달 → 브라우저에 실시간 스트리밍.', color: 'bg-red-50' },
  { from: 'Prometheus',               to: 'itsm-api /metrics',      protocol: 'HTTP GET',       port: ':8000/metrics', direction: '←', detail: '60초 간격 스크래핑. prometheus-fastapi-instrumentator가 요청 수·응답 시간·에러율 노출.', color: 'bg-orange-50' },
  { from: 'Grafana',                  to: 'Prometheus',             protocol: 'HTTP PromQL',    port: ':9090',      direction: '←', detail: 'Prometheus를 데이터소스로 연결. PromQL 쿼리로 시계열 메트릭 조회 및 대시보드 시각화.', color: 'bg-purple-50' },
  { from: 'pg-backup',               to: 'PostgreSQL',             protocol: 'TCP',            port: ':5432',      direction: '→', detail: '24시간 주기로 pg_dump 실행 → /backups/itsm_YYYYMMDD.sql.gz 저장. 7일 경과 파일 자동 삭제.', color: 'bg-gray-50' },
]

/* ─── FAQ 데이터 ─────────────────────────────────────────────────────── */

const FAQ_ITEMS = [
  { q: '티켓을 등록한 후 얼마나 기다려야 하나요?', a: '긴급도에 따라 SLA 목표 시간이 다릅니다. 긴급은 최초응답 4시간·해결 8시간, 높음은 8시간·24시간, 보통은 24시간·72시간, 낮음은 48시간·168시간 이내를 목표로 합니다. 티켓 상세 화면에서 SLA 잔여 시간과 배지(🟢/🟡/🟠/🔴)를 실시간으로 확인할 수 있습니다.' },
  { q: '"처리완료"와 "종료"의 차이는 무엇인가요?', a: '"처리완료"는 IT팀이 작업을 마친 상태로, 사용자의 최종 확인을 기다립니다. 문제가 해결되었음을 확인하면 "종료"로 전환됩니다. 처리완료 상태에서 문제가 재발하면 재처리를 요청할 수 있습니다.' },
  { q: '"승인완료", "운영배포전", "운영반영완료" 상태는 언제 사용하나요?', a: '"승인완료(approved)"는 IT팀이 요청을 검토하여 처리를 승인한 상태입니다. "운영배포전(ready_for_release)"은 개발이 완료되어 운영 배포를 앞두고 있는 상태, "운영반영완료(released)"는 운영 환경에 배포가 완료된 상태입니다. 이 세 상태는 주로 소프트웨어 개발 요청 티켓에서 활용되며, GitLab MR 워크플로우와 함께 사용하면 진행 단계를 명확하게 추적할 수 있습니다.' },
  { q: '서비스 유형(카테고리)을 추가하거나 변경할 수 있나요?', a: '시스템 관리자는 관리 메뉴의 "서비스 유형" 탭에서 카테고리를 직접 추가·수정·삭제할 수 있습니다. 이모지·색상·이름·하위 선택지(context_label, context_options)를 설정하며, 변경 즉시 티켓 등록 폼에 반영됩니다.' },
  { q: 'API 문서(Swagger)는 어디서 볼 수 있나요?', a: 'http://localhost:8111/docs 에서 Swagger UI로, http://localhost:8111/redoc 에서 ReDoc 형태로 전체 API 명세를 확인할 수 있습니다. 인증이 필요한 엔드포인트는 로그인 후 itsm_token 쿠키가 자동으로 포함됩니다.' },
  { q: 'API 키로 외부 시스템을 연동하려면?', a: '관리자가 /admin/api-keys에서 API 키를 발급합니다. 발급 시 스코프(tickets:read, tickets:write, kb:read, kb:write, webhooks:write)를 지정합니다. 외부 시스템에서 Authorization: Bearer itsm_live_xxxx 헤더를 포함하여 ITSM API를 호출합니다. 키 원문은 생성 직후에만 표시되며, 서버에는 SHA-256 해시만 저장됩니다.' },
  { q: '파일 첨부 시 제한이 있나요?', a: '파일당 최대 10MB까지 첨부 가능합니다. 지원 형식: 이미지(JPG, PNG 등), PDF, Office 문서, 텍스트, ZIP, 로그 파일. 파일 형식은 내용(매직바이트)을 직접 검사하여 위장 파일은 거부됩니다. 이미지 첨부 시 EXIF 메타데이터(GPS, 기기 정보 등)가 자동으로 제거됩니다. 모든 파일은 ClamAV 바이러스 스캔을 거칩니다.' },
  { q: '칸반 보드는 어떻게 사용하나요?', a: '헤더의 "칸반" 메뉴 또는 /kanban 경로로 접근합니다. 8개 컬럼(접수됨·승인완료·처리중·대기중·처리완료·운영배포전·운영반영완료·종료)에 티켓 카드가 배치되며, 카드를 드래그하여 컬럼 간 이동하면 티켓 상태가 즉시 변경됩니다. IT 개발자 이상 역할이 필요합니다.' },
  { q: '자주 쓰는 필터를 저장할 수 있나요?', a: '네, 티켓 목록 필터 패널 하단의 "필터 저장" 버튼으로 현재 필터 조합을 이름 붙여 저장할 수 있습니다. 저장된 필터는 드롭다운에서 선택하면 한 번에 적용됩니다. 또한 모든 필터는 URL에 자동 동기화되므로 북마크하거나 링크를 공유할 수 있습니다.' },
  { q: '⌘K(Ctrl+K) 글로벌 검색은 어떻게 동작하나요?', a: '헤더의 검색창을 클릭하거나 ⌘K(Mac) 또는 Ctrl+K(Windows/Linux)를 누르면 글로벌 검색창이 활성화됩니다. 300ms 디바운스로 실시간 검색하며 최대 8건의 결과를 표시합니다. 화살표 키(↑↓)로 탐색하고 Enter로 선택, Esc로 닫을 수 있습니다. GitLab Projects Search API를 활용해 티켓 제목과 설명을 대상으로 검색합니다.' },
  { q: '키보드 단축키는 어떤 것이 있나요?', a: '다음 단축키를 사용할 수 있습니다: g+t(티켓 목록), g+k(칸반 보드), g+b(지식베이스), g+r(리포트), g+a(관리자 메뉴), n(새 티켓 등록), ?(단축키 도움말 표시). 텍스트 입력 필드에서는 단축키가 자동으로 비활성화되어 일반 입력이 가능합니다.' },
  { q: 'KB 아티클을 작성하면 티켓 접수 시 자동으로 보여주나요?', a: '네. 티켓 등록 폼에서 제목을 6자 이상 입력하면 300ms 디바운스 후 /kb/suggest API를 호출하여 관련 KB 아티클을 자동으로 추천합니다. PostgreSQL FTS(전문 검색) 기반으로 제목과 내용의 연관도를 분석하여 결과를 반환합니다. 추천된 아티클을 클릭하면 새 탭에서 바로 확인할 수 있습니다.' },
  { q: '티켓 내용에 비밀번호가 실수로 포함됐는데?', a: '비밀 스캐닝 기능이 AWS Access Key, GitLab PAT, OpenAI API Key, RSA Private Key, DB 비밀번호 등 9개 패턴을 자동 탐지합니다. 탐지된 경우 서버 로그에 경고가 기록되고 해당 내용이 마스킹 처리됩니다. 시스템은 차단하지 않는 fail-soft 방식으로 동작하므로, 탐지 알림 후 즉시 해당 자격증명을 폐기하고 새로 발급받는 것을 권장합니다.' },
  { q: '같은 계정을 여러 기기에서 동시 접속하면?', a: 'MAX_ACTIVE_SESSIONS=5 설정으로 계정당 최대 5개 세션까지 동시 활성화가 가능합니다. 5개를 초과하여 로그인하면 가장 오래된 세션이 자동으로 폐기됩니다. 관리자는 /admin/sessions/{user_id}에서 특정 사용자의 세션 목록을 조회하고 강제 종료(DELETE /admin/sessions/{id})할 수 있습니다.' },
  { q: 'SLA 에스컬레이션 정책은 어디서 설정하나요?', a: '시스템 관리자는 /admin/escalation-policies 에서 설정합니다. 우선순위(긴급/높음/보통/낮음)·트리거(warning: SLA 임박 / breach: SLA 위반)·지연 시간(분)·액션(알림 발송 / 담당자 변경 / 우선순위 자동 상향)을 조합하여 정책을 만들 수 있습니다. SLA 체커(5분 주기)가 자동으로 실행하며 EscalationRecord로 중복 실행을 방지합니다.' },
  { q: '이메일 템플릿을 커스터마이즈할 수 있나요?', a: '시스템 관리자는 /admin/email-templates 에서 5가지 이벤트(ticket_created, status_changed, comment_added, sla_warning, sla_breach)의 이메일 내용을 Jinja2 템플릿 문법({{ variable }})으로 커스터마이즈할 수 있습니다. 미리보기 기능으로 샘플 데이터 렌더링을 확인한 후 저장합니다. DB에 템플릿이 있으면 우선 적용되고, 없거나 비활성화 상태이면 하드코딩된 기본 템플릿으로 폴백됩니다.' },
  { q: '퇴사자 계정은 어떻게 처리되나요?', a: 'FastAPI 백그라운드 스레드가 USER_SYNC_INTERVAL(기본 1시간)마다 GitLab 그룹 멤버 목록을 조회합니다. 그룹에서 제거된 사용자는 ITSM UserRole의 is_active 플래그가 false로 업데이트됩니다. 해당 사용자가 다음 로그인을 시도하면 403 Forbidden이 반환되어 접근이 차단됩니다.' },
  { q: '감사 로그에서 특정 사용자의 행동만 필터링할 수 있나요?', a: '관리 메뉴 > 감사 로그에서 기간(시작일~종료일), 액션 유형(ticket.create / ticket.update 등), 행위자 이름·사용자명으로 검색할 수 있습니다. CSV 다운로드로 외부 보관도 가능합니다. 감사 로그는 PostgreSQL 트리거로 수정·삭제가 원천 차단되어 있습니다.' },
  { q: 'GitLab MR 연결 정보는 어디서 확인하나요?', a: '티켓 상세 화면 중단의 "연결된 Merge Request" 섹션에서 해당 이슈와 연결된 GitLab MR의 제목·상태(opened/merged/closed)·작성자를 확인할 수 있습니다. IT 개발자 이상 역할에서만 표시됩니다.' },
  { q: '에이전트 성과 리포트는 누가 볼 수 있나요?', a: 'IT 관리자(agent) 이상 권한이 있으면 리포트 페이지의 "에이전트 성과" 탭에서 담당자별 처리 건수·SLA 달성률·평균 만족도 평점을 확인할 수 있습니다. 날짜 범위 필터로 기간을 지정할 수 있습니다.' },
  { q: '내부 메모(🔒)는 무엇인가요?', a: 'IT팀 내부에서만 볼 수 있는 비공개 메모입니다. 댓글 입력창 하단의 "내부 메모" 토글을 켜면 작성할 수 있으며, 티켓 신청자에게는 보이지 않습니다. IT 개발자(developer) 이상 역할만 작성 가능합니다.' },
  { q: '알림은 어떻게 받나요?', a: '헤더의 🔔 알림 벨 아이콘에서 티켓 상태 변경·댓글·담당자 배정 등의 인앱 알림을 실시간으로 확인할 수 있습니다(SSE 기반). /notifications/prefs에서 이벤트별 이메일/인앱 알림을 개별 설정할 수 있습니다. 시스템 관리자가 설정한 경우 Telegram 채널과 이메일로도 수신됩니다.' },
  { q: '담당자 배정은 어떻게 이루어지나요?', a: '자동 배정 규칙이 설정된 경우 티켓 접수 시 카테고리·우선순위·키워드 조건에 따라 담당자가 자동 배정됩니다. 자동 배정이 없거나 변경이 필요한 경우 IT 관리자 이상 역할이 티켓 상세 화면의 "담당자" 드롭다운에서 직접 지정합니다.' },
  { q: 'SLA 목표 시간을 변경할 수 있나요?', a: '시스템 관리자는 관리 메뉴의 "SLA 정책" 탭에서 우선순위별 응답·해결 목표 시간을 직접 수정할 수 있습니다. 변경 사항은 새로 등록되는 티켓부터 적용됩니다.' },
  { q: '지식베이스(KB)는 어디서 볼 수 있나요?', a: '헤더의 "지식베이스" 메뉴에서 카테고리·태그·키워드 검색으로 아티클을 찾을 수 있습니다. PostgreSQL 전문 검색(FTS)으로 정확도 높은 결과를 제공합니다. IT 개발자 이상 역할은 아티클을 작성·편집할 수 있습니다.' },
  { q: '개발 프로젝트 전달은 무엇인가요?', a: '소프트웨어 개발이 필요하다고 판단된 경우, 티켓 상세의 사이드바 "전달" 탭에서 대상 프로젝트를 선택하고 메모를 입력하면 해당 GitLab 프로젝트에 이슈가 자동 생성되고 연결됩니다. 전달 이력(프로젝트·이슈 번호·메모·일시)이 티켓에 기록됩니다. IT 개발자(developer) 이상 역할에서 사용 가능합니다.' },
  { q: '개발 프로젝트 전달 드롭다운에 프로젝트가 표시되지 않습니다.', a: '드롭다운에 표시되는 프로젝트는 아래 3가지 조건을 모두 충족해야 합니다.\n① 역할 조건: IT 개발자(developer) 이상이어야 합니다. user 역할이면 드롭다운 자체가 표시되지 않습니다.\n② GitLab 멤버십: 현재 로그인한 사용자가 해당 GitLab 프로젝트의 멤버로 등록되어 있어야 합니다. GitLab 관리자에게 프로젝트 멤버 추가를 요청하세요.\n③ ITSM 전용 프로젝트 제외: 환경변수 GITLAB_PROJECT_ID에 설정된 ITSM 이슈 저장 프로젝트는 자동으로 제외됩니다.\n④ OAuth 토큰 유효: 로그인 후 시간이 많이 지났거나 GitLab 세션이 만료된 경우 빈 목록이 반환됩니다. 로그아웃 후 재로그인하면 해결됩니다.' },
  { q: '개발 프로젝트 전달 드롭다운에 일부 프로젝트만 보입니다.', a: '한 번에 최대 100개 프로젝트까지 조회됩니다. GitLab 멤버십이 있는 프로젝트가 100개를 초과하면 일부 프로젝트가 누락될 수 있습니다. 시스템 관리자에게 문의하세요. 또한 프로젝트 멤버십이 GitLab에서 최근 변경됐다면, 로그아웃 후 재로그인하면 최신 목록이 반영됩니다.' },
  { q: 'IT 개발자(developer) 역할은 무엇이 다른가요?', a: 'IT 개발자는 본인에게 할당된 티켓만 목록에서 조회됩니다. 댓글·내부 메모·티켓 수정·상태 변경·연관 티켓·시간 기록·개발 프로젝트 전달·GitLab MR 조회·지식베이스 작성·편집이 가능합니다. 단, 전체 티켓 조회와 담당자 변경은 IT 관리자 이상에서만 가능합니다.' },
  { q: '실수로 등록한 티켓을 삭제할 수 있나요?', a: '티켓 삭제는 시스템 관리자(admin)만 가능합니다. 일반 사용자는 삭제 권한이 없으므로, 처리가 불필요한 티켓이라면 담당 IT 관리자에게 댓글로 알리거나 "종료" 상태로 전환하여 이력으로 남겨두는 것을 권장합니다.' },
  { q: 'GitLab 계정이 없어도 IT 지원을 요청할 수 있나요?', a: '네, /portal 경로의 고객 셀프서비스 포털을 이용하면 GitLab 계정 없이도 이름·이메일·제목·내용만으로 티켓을 접수할 수 있습니다. 접수 후 이메일로 발송된 추적 링크 또는 화면에 표시된 링크를 통해 진행 상황을 실시간으로 확인할 수 있습니다. 포털 제출은 분당 5건으로 Rate Limit이 적용됩니다.' },
  { q: '"대기중(waiting)" 상태에서도 SLA 시간이 계속 흐르나요?', a: '아니요. "대기중" 상태로 전환되면 SLA 타이머가 자동으로 일시정지됩니다. 외부 응답 대기나 부품 조달 등으로 처리가 중단된 경우 이 시간은 SLA 경과 시간에 포함되지 않습니다. 상태가 "처리중"이나 다른 상태로 변경되면 타이머가 재개됩니다.' },
  { q: 'MR(Merge Request)을 머지하면 관련 티켓이 자동으로 해결되나요?', a: '네. MR 제목이나 설명에 "Closes #N", "Fixes #N", 또는 "#N" 패턴을 포함하면, 해당 MR이 머지될 때 ITSM 티켓 #N이 자동으로 "처리완료(resolved)" 상태로 전환됩니다. 티켓에는 자동 코멘트가 추가됩니다.' },
  { q: '이메일로 티켓을 접수할 수 있나요?', a: '시스템 관리자가 IMAP 설정(IMAP_ENABLED=true, IMAP_HOST, IMAP_USER, IMAP_PASSWORD 등)을 구성하면, 지정된 이메일 수신함을 주기적으로 확인하여 수신된 메일을 자동으로 티켓으로 변환합니다. 동일 Message-ID의 중복 생성을 방지하며, 접수 확인 이메일이 발신자에게 자동 회신됩니다.' },
  { q: '빠른 답변(Quick Reply) 템플릿은 어떻게 사용하나요?', a: '티켓 상세 화면의 코멘트 입력창 하단에 "💬 빠른 답변" 드롭다운이 있습니다. 드롭다운을 열면 서버에 등록된 템플릿 목록이 나타나며, 선택하면 해당 내용이 자동으로 입력창에 채워집니다. 관리 메뉴 > 빠른 답변 탭에서 이름·카테고리·내용을 설정하여 새 템플릿을 추가할 수 있습니다. IT 에이전트 이상 권한이 필요합니다.' },
  { q: '티켓 구독(Watcher)은 무엇이고 어떻게 사용하나요?', a: '티켓 상세 화면 우측 사이드바 하단의 "🔕 이 티켓 구독" 버튼을 클릭하면 해당 티켓의 구독자(Watcher)로 등록됩니다. 구독 중에는 버튼이 "🔔 구독 중 (클릭하여 취소)"로 바뀌며, 다시 클릭하면 구독이 취소됩니다.\n\n구독하면 받는 알림:\n• 티켓 상태 변경 시 이메일 알림\n• 공개 댓글(새 답변) 등록 시 이메일 알림\n\n받지 않는 알림:\n• 내부 메모(🔒)는 구독자에게 전달되지 않습니다\n• 현재 구독자 알림은 이메일 전용이며, 인앱 벨(🔔) 알림은 지원되지 않습니다\n\n활용 예시:\n• 담당자가 아닌 팀원이 중요 장애 티켓의 진행 상황을 추적할 때\n• 팀장이 관심 있는 티켓의 처리 결과를 확인할 때\n• 관련 부서 담당자가 자신에게 영향을 주는 시스템 오류 티켓을 모니터링할 때\n\n주의: 알림을 이메일로 받으려면 GitLab 계정에 이메일이 등록되어 있어야 합니다.' },
  { q: '커밋 메시지에서 티켓을 참조하면 어떻게 되나요?', a: 'GitLab에 코드를 Push할 때 커밋 메시지에 "Closes #3", "Fixes #5", "Refs #10" 등의 패턴을 포함하면 ITSM이 해당 티켓에 자동 코멘트를 추가합니다. 코멘트에는 커밋 해시·메시지·저자·GitLab 커밋 링크가 포함됩니다.' },
  { q: 'GitLab CI/CD 파이프라인이 실패하면 티켓에 알림이 오나요?', a: '네. GitLab Pipeline Hook이 연동되어 있으면, 파이프라인 실패(failed 상태) 시 해당 커밋이나 MR에서 참조한 ITSM 티켓에 "🚨 파이프라인 #N 실패: {branch}" 코멘트가 자동으로 추가됩니다.' },
  { q: 'SLA 기한이 임박하면 알림을 받을 수 있나요?', a: '네. SLA 해결 기한 1시간 전에 담당자에게 사전 경고 알림이 자동 전송됩니다. 시스템은 5분 주기로 SLA 상태를 점검하여 임박 티켓을 감지하고, 인앱 알림과 함께 설정된 경우 이메일·Telegram으로도 경고를 발송합니다. SLA 에스컬레이션 정책이 설정된 경우 담당자 변경·우선순위 상향 등의 추가 액션도 자동 실행됩니다.' },
  { q: '감사 로그에는 어떤 액션들이 기록되나요?', a: '다음 액션들이 기록됩니다: ticket.create(티켓 생성), ticket.update(티켓 수정), ticket.delete(티켓 삭제), ticket.bulk_update(일괄 작업), comment.create(댓글 작성), comment.delete(댓글 삭제), attachment.upload(파일 첨부), ticket.forward(개발 전달), user.role_change(역할 변경). 각 이벤트에는 수행자 이름·역할·IP 주소·타임스탬프가 기록됩니다. PostgreSQL 트리거로 수정·삭제가 원천 차단됩니다(Immutable).' },
  { q: '관리자 메뉴에는 어떤 탭들이 있나요?', a: '시스템 관리자(/admin)에는 현재 다음 탭들이 있습니다: 사용자 관리, SLA 정책, 에스컬레이션 정책, 이메일 템플릿(Jinja2), 서비스 유형, 자동배정 규칙, 티켓 템플릿, 빠른 답변, 공지사항/배너, 아웃바운드 웹훅, API 키, GitLab 라벨 동기화, 감사 로그. 사용자 관리 페이지에서는 세션 강제 종료 기능도 제공됩니다.' },
  { q: 'Prometheus/Grafana는 어떻게 접근하나요?', a: 'Prometheus는 http://localhost:9090, Grafana는 http://localhost:3001 에서 접근합니다. 별도 profile 설정 없이 항상 기동됩니다. Grafana에는 4개 대시보드가 자동 프로비저닝됩니다: ① ITSM 운영 대시보드(RED 메트릭+시스템 리소스), ② ITSM 성능 분석(레이턴시 퍼센타일), ③ ITSM SLA 모니터링(가용성/Apdex/에러버짓), ④ ITSM 메뉴별 운영 현황(비즈니스 KPI 27종 — 티켓·KB·칸반·리포트·관리 메뉴별 지표).' },
  { q: 'Alembic 마이그레이션은 어떻게 적용하나요?', a: 'Docker Compose 시작 시 FastAPI 컨테이너가 자동으로 alembic upgrade head를 실행하여 최신 스키마로 마이그레이션합니다. 현재 0001부터 0041까지 41단계 마이그레이션이 관리됩니다(0041: 중복 인덱스 제거). 수동 적용: docker compose exec itsm-api alembic upgrade head 명령을 실행합니다.' },
  { q: '타임라인 뷰는 어떻게 사용하나요?', a: '티켓 상세 화면의 "처리 내역" 탭 옆 "타임라인" 탭을 클릭하면 해당 티켓의 모든 이력(댓글·GitLab 시스템 메시지·감사 이벤트)을 시간 순서대로 통합하여 볼 수 있습니다. 이벤트 유형별 색상(댓글=흰색·시스템=회색·감사=색상)과 세로 연결선으로 흐름을 직관적으로 파악할 수 있습니다. IT 개발자 이상 역할에서 사용 가능합니다.' },
  { q: '첨부 이미지·PDF를 바로 볼 수 있나요?', a: '이미지 첨부파일은 티켓 상세 화면에서 썸네일로 표시되며, 클릭하면 라이트박스(전체 화면 오버레이)로 확대 보기가 가능합니다. 오른쪽 상단의 다운로드 버튼으로 즉시 저장할 수 있습니다. PDF 파일은 "미리보기" 버튼 클릭 시 모달 내 iframe으로 인라인 렌더링됩니다. PDF 뷰어에서도 다운로드가 가능합니다.' },
  { q: '검색 히스토리는 어떻게 관리하나요?', a: '⌘K(Ctrl+K) 글로벌 검색창에서 검색 후 결과를 선택하면 최근 검색어가 자동으로 저장됩니다. 검색어가 없을 때 검색창을 열면 최근 검색 히스토리(최대 6개)가 표시됩니다. 항목 오른쪽의 × 버튼으로 개별 삭제, "전체 삭제" 버튼으로 모두 지울 수 있습니다. 히스토리는 브라우저 localStorage에 저장됩니다.' },
  { q: '티켓 처리 완료 시 해결 노트는 어떻게 남기나요?', a: '에이전트가 티켓 상태를 "처리완료" 또는 "종료"로 변경할 때 해결 노트 모달이 자동으로 표시됩니다. 해결 내용·해결 유형(즉시 해결/임시 조치/외부 의뢰 등)·원인을 구조화하여 입력하면 DB에 별도 저장됩니다. 해결 노트는 유사 문제 재발 시 참고 자료로 활용하거나 KB 아티클 작성의 기초 자료로 사용할 수 있습니다.' },
  { q: 'Sudo 모드(관리자 재인증)는 왜 필요한가요?', a: '관리자가 세션을 열어둔 상태에서 자리를 비운 경우 제3자가 고위험 관리 작업을 수행하는 것을 방지합니다. 사용자 역할 변경, 세션 강제 종료 등 민감한 작업 전에 GitLab 비밀번호로 재인증을 요구합니다. Sudo 토큰은 15분 유효하며, 만료 후 다시 재인증이 필요합니다.' },
  { q: '구독 중인 티켓 목록은 어디서 볼 수 있나요?', a: '헤더 알림 벨(🔔) 드롭다운 하단의 "🔔 구독 중인 티켓" 링크를 클릭하거나, /notifications 페이지에 접속하면 됩니다. 페이지의 첫 번째 탭인 "🔔 구독 중인 티켓"에서 내가 Watcher로 등록된 모든 티켓의 제목·상태·우선순위·담당자·구독일이 표시됩니다. 각 행의 🔕 버튼을 클릭하면 즉시 구독 취소됩니다.' },
  { q: '서비스 유형(카테고리)을 삭제하려는데 삭제 버튼이 비활성화됩니다.', a: '해당 서비스 유형을 사용하는 티켓이 있으면 삭제가 차단됩니다. 목록에서 "🎫 N건 사용 중" 뱃지로 사용 현황을 확인할 수 있습니다. 해결 방법: ① 해당 티켓의 카테고리를 다른 서비스 유형으로 변경한 후 삭제하거나, ② 삭제 대신 서비스 유형을 "비활성화"하면 티켓 등록 폼에서만 숨겨지고 기존 데이터는 보존됩니다.' },
  { q: 'GitLab 라벨이 ITSM과 맞지 않게 표시됩니다.', a: '관리 메뉴 → GitLab 라벨 동기화(/admin/labels)에서 현황을 확인하세요. status::/prio::/cat:: 라벨이 GitLab 프로젝트·그룹에 존재하는지 ✅/❌로 표시됩니다. 누락된 라벨이 있으면 "전체 동기화" 버튼을 클릭하면 자동 복구됩니다. 서비스 유형 추가·수정 시에는 cat:: 라벨이 자동으로 동기화되므로 별도 작업이 불필요합니다.' },
  { q: '해결 노트를 지식베이스(KB) 아티클로 만들 수 있나요?', a: '네. 티켓 상태가 처리완료 또는 종료이고 해결 노트가 작성된 경우, 티켓 상세 화면에서 만족도 평가 위에 해결 노트 카드가 표시됩니다. IT 에이전트 이상 역할이면 카드 우측 상단의 "📚 KB 아티클로 변환" 버튼을 클릭하면 해결 노트 내용을 바탕으로 KB 아티클 초안이 자동 생성되고, 생성된 KB 페이지로 바로 이동합니다. 이미 변환된 경우에는 "KB 아티클 보기 →" 링크로 대체됩니다.' },
  { q: '관리자 메뉴 탭 목록이 변경됐나요?', a: '시스템 관리자(/admin)의 현재 메뉴는 다음과 같습니다: 사용자 관리, SLA 정책, 에스컬레이션 정책, 이메일 템플릿, 서비스 유형, 자동배정 규칙, 티켓 템플릿, 빠른 답변, 공지사항/배너(신규), 이메일 알림 연동, 아웃바운드 웹훅, API 키, GitLab 라벨 동기화(신규), 감사 로그. 총 14개 탭입니다.' },
  { q: '칸반에서 특정 컬럼으로 카드를 드래그해도 이동이 안됩니다.', a: '상태 전환 규칙에 따라 이동할 수 없는 컬럼으로는 드롭이 차단됩니다. 드래그 시작 시점에 이동 가능한 컬럼만 파란색으로 강조되고, 이동 불가 컬럼은 흐릿하게(40%) 표시됩니다.\n\n상태별 허용 전환:\n• 접수됨 → 처리중, 추가정보 대기, 종료됨\n• 처리중 → 처리완료, 추가정보 대기, 종료됨\n• 추가정보 대기 → 처리중, 종료됨\n• 처리완료 → 처리중, 종료됨\n• 종료됨 → 접수됨(재오픈)\n\n예를 들어 "접수됨"에서 "처리완료"로 바로 이동하는 것은 허용되지 않습니다.' },
  { q: '티켓 목록에서 카테고리 필터가 작동하지 않습니다.', a: '카테고리 필터를 선택해도 결과가 나오지 않는 경우, 다음을 확인하세요.\n\n① 선택한 카테고리에 해당하는 티켓이 실제로 없을 수 있습니다.\n② "기타" 카테고리는 cat:: 라벨이 없는 모든 티켓을 포함합니다. 대부분의 기존 티켓은 카테고리 라벨 없이 생성되었으므로 "기타"를 선택하면 다수가 표시됩니다.\n③ 새로 등록하는 티켓은 카테고리를 선택하면 해당 라벨이 GitLab에 자동 저장됩니다.\n\n정확한 필터링을 위해 티켓 등록 시 카테고리를 반드시 선택해 주세요.' },
  { q: '이메일 템플릿 미리보기가 이전과 다르게 표시됩니다.', a: '이메일 미리보기가 보안 강화를 위해 sandbox iframe 방식으로 변경되었습니다. 이전에는 HTML이 직접 렌더링되어 스크립트 실행 위험이 있었으나, 현재는 스크립트 실행이 완전히 차단된 안전한 환경에서 렌더링됩니다. 미리보기 내용이 잘려보이면 스크롤하거나 모달 크기를 조절하세요.' },
  { q: 'SLA 정책 시간에 0이나 음수를 입력하면 어떻게 되나요?', a: 'SLA 응답 시간과 해결 시간은 최소 1시간 이상이어야 합니다. 0 또는 음수 값을 입력하면 서버에서 422 오류를 반환하고 저장되지 않습니다. 관리 > SLA 정책 화면에서도 숫자 입력 필드의 min=1 속성으로 1 미만 입력이 차단됩니다.' },
  { q: 'API 키를 같은 이름으로 두 개 만들 수 없나요?', a: '동일한 이름의 활성 API 키는 중복 생성이 차단됩니다. 이름이 겹치면 "이미 존재합니다" 오류가 반환됩니다. 기존 키를 비활성화하거나 삭제한 후 동일 이름으로 새 키를 생성하는 것은 가능합니다.' },
  { q: '내 자신의 역할을 변경할 수 없습니다.', a: '관리자(admin)라도 자기 자신의 역할을 변경하는 것은 시스템에서 차단됩니다. 이는 실수로 본인을 일반 사용자로 강등시켜 관리자가 없는 상태가 되는 것을 방지하기 위한 조치입니다. 자신의 역할 변경이 필요한 경우 다른 관리자에게 요청하세요.' },
]

/* ─── 헬퍼 컴포넌트 ──────────────────────────────────────────────────── */

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
        {number}
      </div>
      <h2 className="text-lg font-bold text-gray-800">{title}</h2>
    </div>
  )
}

function NewBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-500 text-white leading-none shrink-0">
      NEW
    </span>
  )
}

function ComparisonCell({ value }: { value: string }) {
  const cls =
    value === '✅' ? 'text-green-600 font-bold' :
    value === '⚠️' ? 'text-yellow-600' :
    value === '❌' ? 'text-red-400' :
    'text-gray-400 text-xs'
  return <td className={`py-2 px-2 text-center text-sm ${cls}`}>{value}</td>
}

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded font-mono shrink-0 w-16 text-center ${METHOD_BADGE[method]}`}>
      {method}
    </span>
  )
}

/* ─── 탭: 시작하기 ────────────────────────────────────────────────────── */

function TabStart() {
  return (
    <>
      {/* 빠른 링크 */}
      <section className="mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              target={link.href.startsWith('http') ? '_blank' : undefined}
              rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-colors ${link.color}`}
            >
              <span className="text-2xl">{link.emoji}</span>
              <div>
                <div className="font-semibold text-sm">{link.label}</div>
                <div className="text-xs opacity-75 mt-0.5">{link.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 티켓 등록 단계 */}
      <section className="mb-10">
        <SectionTitle number="1" title="티켓 등록 방법" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="space-y-0">
            {REGISTRATION_STEPS.map((s, i) => (
              <div key={s.step} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                    {s.step}
                  </div>
                  {i < REGISTRATION_STEPS.length - 1 && <div className="w-0.5 flex-1 bg-blue-100 my-1" />}
                </div>
                <div className={`pb-6 flex-1 ${i === REGISTRATION_STEPS.length - 1 ? 'pb-0' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.icon}</span>
                    <span className="font-semibold text-gray-800">{s.title}</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
                  {s.tip && (
                    <div className="mt-2 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      <span className="text-blue-500 text-xs shrink-0 mt-0.5">💡 TIP</span>
                      <p className="text-xs text-blue-700 leading-relaxed">{s.tip}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 카테고리 안내 */}
      <section className="mb-10">
        <SectionTitle number="2" title="카테고리 안내" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <p className="text-sm text-gray-500 mb-4">
            카테고리(서비스 유형)는 시스템 관리자가 관리 메뉴에서 동적으로 추가·수정할 수 있습니다. 아래는 기본 제공 카테고리 예시입니다.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CATEGORIES_INFO.map((cat) => (
              <div key={cat.label} className={`border-2 rounded-xl p-4 ${cat.color}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{cat.emoji}</span>
                  <span className="font-bold text-gray-800">{cat.label}</span>
                </div>
                <ul className="space-y-1">
                  {cat.examples.map((ex) => (
                    <li key={ex} className="text-xs text-gray-600 flex items-start gap-1">
                      <span className="mt-0.5 shrink-0">•</span>
                      <span>{ex}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 키보드 단축키 안내 */}
      <section className="mb-10">
        <SectionTitle number="3" title="키보드 단축키" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-gray-500">입력 필드(텍스트 박스, 에디터 등)에서는 단축키가 자동으로 비활성화됩니다.</span>
            <NewBadge />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'g → t', desc: '티켓 목록으로 이동' },
              { key: 'g → k', desc: '칸반 보드로 이동' },
              { key: 'g → b', desc: '지식베이스로 이동' },
              { key: 'g → r', desc: '리포트로 이동' },
              { key: 'g → a', desc: '관리자 메뉴로 이동 (Admin)' },
              { key: 'n',     desc: '새 티켓 등록 폼 열기' },
              { key: '⌘K / Ctrl+K', desc: '글로벌 검색 열기' },
              { key: '?',     desc: '단축키 도움말 표시' },
            ].map((s) => (
              <div key={s.key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <kbd className="inline-flex items-center px-2 py-1 rounded bg-white border border-gray-300 shadow-sm font-mono text-xs text-gray-700 shrink-0 min-w-[80px] justify-center">
                  {s.key}
                </kbd>
                <span className="text-sm text-gray-600">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 역할 요약 */}
      <section className="mb-10">
        <SectionTitle number="4" title="역할(Role) 요약" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { role: '현업 사용자', emoji: '👤', color: 'border-blue-300 bg-blue-50', desc: '티켓 등록·조회·평가. 본인 티켓만 열람합니다.' },
              { role: 'IT 개발자', emoji: '💻', color: 'border-purple-300 bg-purple-50', desc: '할당된 티켓 처리. 내부 메모, KB 작성. 칸반 접근.' },
              { role: 'IT 에이전트', emoji: '🎧', color: 'border-teal-300 bg-teal-50', desc: '전체 티켓 관리, 담당자 배정, 리포트, 일괄 작업.' },
              { role: 'IT 관리자', emoji: '⚙️', color: 'border-red-300 bg-red-50', desc: '사용자 역할, SLA 정책, 에스컬레이션, API 키 등 전체 관리.' },
            ].map((r) => (
              <div key={r.role} className={`border-2 rounded-xl p-4 ${r.color}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{r.emoji}</span>
                  <span className="font-bold text-sm text-gray-800">{r.role}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 탭: 기능 안내 ──────────────────────────────────────────────────── */

function TabFeatures() {
  return (
    <>
      {/* 전체 기능 목록 */}
      <section className="mb-10">
        <SectionTitle number="1" title="전체 기능 목록" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ALL_FEATURES.map((f) => (
            <div key={f.title} className="bg-white border rounded-xl p-4 shadow-sm hover:border-blue-300 transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0">{f.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-800 text-sm">{f.title}</span>
                    {f.isNew && <NewBadge />}
                  </div>
                  <div className="text-xs text-blue-600 font-medium mb-1">{f.note}</div>
                  <p className="text-xs text-gray-600 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 보안 기능 */}
      <section className="mb-10">
        <SectionTitle number="2" title="보안 기능" />
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-gray-500">아래 보안 기능들은 시스템 수준에서 자동으로 동작하며 별도 설정 없이 활성화됩니다.</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SECURITY_FEATURES.map((f) => (
            <div key={f.title} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-400 transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0">{f.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-800 text-sm">{f.title}</span>
                    {f.isNew && <NewBadge />}
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 모니터링 */}
      <section className="mb-10">
        <SectionTitle number="3" title="모니터링 (Prometheus + Grafana)" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <NewBadge />
            <span className="text-sm text-gray-600">Prometheus(:9090)와 Grafana(:3001)는 별도 profile 없이 항상 기동됩니다.</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: 'ITSM 운영 대시보드',
                icon: '📊',
                color: 'border-orange-200 bg-orange-50',
                items: ['RED 메트릭 (Rate·Error·Duration)', '시스템 리소스 (CPU/메모리/디스크)', '요청 처리량 실시간 그래프', '에러율 추이'],
              },
              {
                title: 'ITSM 성능 분석',
                icon: '⚡',
                color: 'border-blue-200 bg-blue-50',
                items: ['응답 레이턴시 퍼센타일 (p50/p95/p99)', '엔드포인트별 처리량 분석', '슬로우 쿼리 감지', 'API 병목 구간 시각화'],
              },
              {
                title: 'ITSM SLA 모니터링',
                icon: '🎯',
                color: 'border-green-200 bg-green-50',
                items: ['서비스 가용성 (Availability)', 'Apdex 점수 (사용자 만족도 지수)', '에러 버짓 트래킹', 'SLA 위반 건수 추이'],
              },
            ].map((d) => (
              <div key={d.title} className={`border-2 rounded-xl p-4 ${d.color}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">{d.icon}</span>
                  <span className="font-bold text-sm text-gray-800">{d.title}</span>
                </div>
                <ul className="space-y-1">
                  {d.items.map((item) => (
                    <li key={item} className="text-xs text-gray-600 flex items-start gap-1">
                      <span className="shrink-0 mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* API 키 및 아웃바운드 웹훅 */}
      <section className="mb-10">
        <SectionTitle number="4" title="외부 시스템 연동" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🔑</span>
              <span className="font-bold text-gray-800">API 키 인증</span>
              <NewBadge />
            </div>
            <p className="text-sm text-gray-600 mb-3">외부 시스템에서 ITSM API를 직접 호출할 때 사용합니다.</p>
            <div className="bg-gray-900 rounded-lg p-3 mb-3">
              <code className="text-xs text-green-400 font-mono">
                Authorization: Bearer itsm_live_xxxx
              </code>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <div><span className="font-medium">스코프:</span> tickets:read, tickets:write, kb:read, kb:write, webhooks:write</div>
              <div><span className="font-medium">관리:</span> /admin/api-keys</div>
              <div><span className="font-medium">보안:</span> SHA-256 해시 저장 (평문 미보관)</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🔗</span>
              <span className="font-bold text-gray-800">아웃바운드 웹훅</span>
              <NewBadge />
            </div>
            <p className="text-sm text-gray-600 mb-3">ITSM 이벤트 발생 시 외부 서비스로 즉시 알림을 전송합니다.</p>
            <div className="text-xs text-gray-500 space-y-1">
              <div><span className="font-medium">지원 서비스:</span> Slack Incoming Webhook, Teams Power Automate</div>
              <div><span className="font-medium">서명:</span> HMAC-SHA256 시그니처 검증</div>
              <div><span className="font-medium">재시도:</span> 3회 지수 백오프 (실패 시)</div>
              <div><span className="font-medium">관리:</span> /admin/outbound-webhooks</div>
              <div><span className="font-medium">테스트:</span> POST /admin/outbound-webhooks/{'{'}id{'}'}/test</div>
            </div>
          </div>
        </div>
      </section>

      {/* 티켓 구독 (Watcher) */}
      <section className="mb-10">
        <SectionTitle number="5" title="티켓 구독 (Watcher) — 상세 안내" />
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">

          {/* 개요 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 leading-relaxed">
            담당자나 신청자가 아니어도 <strong>관심 있는 티켓의 진행 상황을 이메일로 추적</strong>할 수 있는 기능입니다.
            티켓 상세 화면 우측 사이드바 하단의 <strong>🔕 이 티켓 구독</strong> 버튼으로 등록·취소합니다.
          </div>

          {/* 사용 방법 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">사용 방법</h3>
            <div className="space-y-2">
              {[
                { step: '1', text: '티켓 상세 페이지 → 우측 사이드바 하단으로 스크롤' },
                { step: '2', text: '"🔕 이 티켓 구독" 버튼 클릭 → 즉시 구독 등록' },
                { step: '3', text: '버튼이 "🔔 구독 중 (클릭하여 취소)"로 변경됨' },
                { step: '4', text: '이후 이벤트 발생 시 이메일로 알림 수신' },
                { step: '5', text: '구독 취소: 버튼 다시 클릭' },
              ].map(item => (
                <div key={item.step} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{item.step}</div>
                  <p className="text-sm text-gray-700 pt-0.5">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 알림 수신 상세 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">알림 수신 내역</h3>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2.5 text-left">이벤트</th>
                    <th className="px-4 py-2.5 text-center">이메일 알림</th>
                    <th className="px-4 py-2.5 text-center">인앱(벨) 알림</th>
                    <th className="px-4 py-2.5 text-left">비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    { event: '티켓 상태 변경', email: '✅', inapp: '❌', note: '접수됨→처리중→완료 등 모든 상태 전환' },
                    { event: '공개 댓글 등록', email: '✅', inapp: '❌', note: 'IT팀의 공개 답변' },
                    { event: '내부 메모(🔒) 등록', email: '❌', inapp: '❌', note: '비공개 메모는 구독자에게 전달 안 됨' },
                    { event: '담당자 변경', email: '❌', inapp: '❌', note: '담당자 본인에게만 별도 알림' },
                    { event: 'SLA 임박·위반 경고', email: '❌', inapp: '❌', note: '담당자·에이전트에게만 발송' },
                  ].map(row => (
                    <tr key={row.event} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700 font-medium">{row.event}</td>
                      <td className="px-4 py-2.5 text-center text-base">{row.email}</td>
                      <td className="px-4 py-2.5 text-center text-base">{row.inapp}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 역할별 활용 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">역할별 활용 예시</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { role: '일반 사용자', emoji: '👤', bg: 'bg-gray-50 border-gray-200',
                  text: '내가 신청하지 않은 티켓이지만 관련 시스템 장애 현황을 추적하고 싶을 때' },
                { role: 'IT 개발자', emoji: '💻', bg: 'bg-blue-50 border-blue-200',
                  text: '직접 담당은 아니지만 내가 관리하는 시스템 관련 티켓의 처리 경과를 확인하고 싶을 때' },
                { role: 'IT 에이전트', emoji: '🎧', bg: 'bg-purple-50 border-purple-200',
                  text: '중요 장애 티켓의 해결 과정을 동료가 처리하는 동안 함께 모니터링할 때' },
                { role: '팀장 / 관리자', emoji: '👔', bg: 'bg-amber-50 border-amber-200',
                  text: '우선순위 높은 티켓의 처리 결과를 별도 확인 없이 이메일로 받아보고 싶을 때' },
              ].map(item => (
                <div key={item.role} className={`rounded-xl border p-3.5 ${item.bg}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span>{item.emoji}</span>
                    <span className="text-sm font-semibold text-gray-800">{item.role}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 제한 사항 */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-yellow-800 mb-2">⚠️ 현재 제한 사항</h3>
            <ul className="text-xs text-yellow-700 space-y-1.5 leading-relaxed">
              <li>• <strong>이메일 전용</strong> — 인앱 벨(🔔) 알림은 지원되지 않습니다. 이메일로만 수신됩니다.</li>
              <li>• <strong>GitLab 이메일 필수</strong> — GitLab 계정에 이메일이 등록되지 않으면 알림을 받을 수 없습니다.</li>
              <li>• <strong>구독자 수 비표시</strong> — 현재 티켓에 몇 명이 구독 중인지 화면에 표시되지 않습니다.</li>
              <li>• <strong>내부 메모 제외</strong> — 🔒 내부 메모(비공개 댓글)는 구독자 알림에서 제외됩니다.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 개발 프로젝트 전달 */}
      <section className="mb-10">
        <SectionTitle number="6" title="개발 프로젝트 전달 — 표시 조건 상세" />
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">

          {/* 개요 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 leading-relaxed">
            티켓 상세 사이드바 <strong>"전달"</strong> 탭의 프로젝트 드롭다운에는{' '}
            <strong>현재 로그인한 사용자의 GitLab OAuth 토큰</strong>으로 조회한 결과가 채워집니다.
            서비스 계정(PRIVATE-TOKEN)이 아닌 <strong>개인 OAuth 토큰</strong>을 사용하므로,
            사용자마다 보이는 프로젝트 목록이 다릅니다.
          </div>

          {/* 표시 조건 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">표시 조건 (4가지 모두 충족해야 함)</h3>
            <div className="space-y-3">
              {[
                {
                  num: '1',
                  color: 'bg-blue-600',
                  title: '역할 조건 — IT 개발자(developer) 이상',
                  desc: 'user 역할이면 드롭다운 자체가 렌더링되지 않습니다. 관리자에게 역할 변경을 요청하세요.',
                  icon: '👤',
                },
                {
                  num: '2',
                  color: 'bg-purple-600',
                  title: 'GitLab 멤버십 — 해당 프로젝트의 멤버로 등록',
                  desc: 'GitLab API GET /projects?membership=true 로 조회합니다. 해당 프로젝트에 멤버가 아니면 목록에 나타나지 않습니다. GitLab에서 프로젝트 멤버로 추가해달라고 요청하세요.',
                  icon: '🔗',
                },
                {
                  num: '3',
                  color: 'bg-orange-500',
                  title: 'ITSM 전용 프로젝트 제외 — GITLAB_PROJECT_ID 자동 제외',
                  desc: '이슈를 저장하는 ITSM 전용 프로젝트(.env의 GITLAB_PROJECT_ID)는 드롭다운에서 자동으로 제외됩니다. 정상 동작입니다.',
                  icon: '🚫',
                },
                {
                  num: '4',
                  color: 'bg-green-600',
                  title: 'OAuth 토큰 유효 — 로그인 세션이 살아 있어야 함',
                  desc: '로그인 후 GitLab OAuth 토큰이 만료됐거나 GitLab 세션이 끊기면 빈 배열이 반환됩니다. 로그아웃 후 재로그인하면 새 토큰이 발급되어 목록이 복구됩니다.',
                  icon: '🔑',
                },
              ].map((item) => (
                <div key={item.num} className="flex gap-3">
                  <div className={`w-7 h-7 rounded-full ${item.color} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
                    {item.num}
                  </div>
                  <div className="flex-1 bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{item.icon}</span>
                      <span className="font-semibold text-sm text-gray-800">{item.title}</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 동작 흐름 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">내부 동작 흐름</h3>
            <div className="bg-gray-50 rounded-xl p-4 font-mono text-xs text-gray-600 space-y-1 leading-relaxed">
              <div>사용자 로그인 → JWT에 <span className="text-blue-600">gitlab_token</span> (OAuth Access Token) 저장</div>
              <div className="pl-4 text-gray-400">↓</div>
              <div>티켓 상세 진입 → <span className="text-orange-600">GET /admin/dev-projects</span> 호출</div>
              <div className="pl-4 text-gray-400">↓</div>
              <div>GitLab API: <span className="text-purple-600">GET /api/v4/projects?membership=true&per_page=100</span></div>
              <div className="pl-4 text-gray-400">↓ (사용자 OAuth 토큰으로 조회)</div>
              <div>응답에서 <span className="text-red-500">GITLAB_PROJECT_ID</span> 제외 후 드롭다운에 표시</div>
            </div>
          </div>

          {/* 문제 해결 표 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">트러블슈팅</h3>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b text-gray-500">
                    <th className="px-4 py-2.5 text-left font-semibold">증상</th>
                    <th className="px-4 py-2.5 text-left font-semibold">원인</th>
                    <th className="px-4 py-2.5 text-left font-semibold">해결 방법</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    { symptom: '"전달" 탭 자체가 없음', cause: '역할이 user', fix: '관리자에게 developer 이상 역할 부여 요청' },
                    { symptom: '드롭다운이 비어 있음', cause: 'GitLab 프로젝트 멤버가 아님', fix: 'GitLab에서 해당 프로젝트에 멤버 추가' },
                    { symptom: '드롭다운이 비어 있음 (재로그인 후 해결)', cause: 'OAuth 토큰 만료', fix: '로그아웃 → 재로그인' },
                    { symptom: 'ITSM 프로젝트가 목록에 없음', cause: '정상 동작 (자동 제외)', fix: '조치 불필요' },
                    { symptom: '100개 이상 프로젝트 누락', cause: 'per_page=100 한도 초과', fix: '시스템 관리자에게 문의' },
                    { symptom: '방금 멤버 추가했는데 안 뜸', cause: '기존 OAuth 토큰 캐시', fix: '로그아웃 → 재로그인으로 새 토큰 발급' },
                  ].map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700">{row.symptom}</td>
                      <td className="px-4 py-2.5 text-gray-500">{row.cause}</td>
                      <td className="px-4 py-2.5 text-blue-600 font-medium">{row.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 탭: 워크플로우 & SLA ───────────────────────────────────────────── */

function TabWorkflow() {
  return (
    <>
      {/* 티켓 상태 워크플로우 */}
      <section className="mb-10">
        <SectionTitle number="1" title="티켓 상태 워크플로우" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex flex-wrap gap-2 items-center justify-center mb-6">
            {WORKFLOW_NODES.map((node, i) => (
              <div key={node.id} className="flex items-center gap-2">
                <div className={`border-2 rounded-xl px-4 py-2.5 text-center min-w-[100px] ${node.color}`}>
                  <div className="text-lg mb-0.5">{node.emoji}</div>
                  <div className="font-bold text-xs">{node.label}</div>
                  {node.note && (
                    <div className="text-xs opacity-70 mt-0.5">{node.note}</div>
                  )}
                </div>
                {i < WORKFLOW_NODES.length - 1 && (
                  <span className="text-gray-300 font-bold text-lg">→</span>
                )}
              </div>
            ))}
          </div>

          <div className="border-t pt-4">
            <h4 className="font-semibold text-sm text-gray-700 mb-3">주요 자동화 트리거</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { trigger: '대기중 전환', effect: 'SLA 타이머 자동 일시정지 (total_paused_seconds 누적)', icon: '⏸️' },
                { trigger: '대기중 → 다른 상태', effect: 'SLA 타이머 재개 (정지 시간 제외 계산)', icon: '▶️' },
                { trigger: 'GitLab MR 머지 (Closes #N)', effect: '티켓 자동 "처리완료" 전환 + 자동 코멘트', icon: '🔀' },
                { trigger: '종료 후 재오픈', effect: '"재개됨" 상태로 전환, SLA 재시작', icon: '🔄' },
              ].map((t) => (
                <div key={t.trigger} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-lg shrink-0">{t.icon}</span>
                  <div>
                    <div className="font-semibold text-xs text-gray-700">{t.trigger}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{t.effect}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SLA 정책 */}
      <section className="mb-10">
        <SectionTitle number="2" title="SLA 정책 (우선순위별)" />
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">우선순위</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">설명</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-700">최초 응답</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-700">해결 목표</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">예시</th>
                </tr>
              </thead>
              <tbody>
                {SLA_ROWS.map((row) => (
                  <tr key={row.priority} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${row.color}`}>
                        {row.emoji} {row.priority}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-xs">{row.desc}</td>
                    <td className="py-3 px-4 text-center font-bold text-gray-800">{row.response}h</td>
                    <td className="py-3 px-4 text-center font-bold text-gray-800">{row.resolve}h</td>
                    <td className="py-3 px-4 text-gray-500 text-xs">{row.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-blue-50 border-t text-xs text-blue-700">
            💡 SLA 목표 시간은 관리자 메뉴 → "SLA 정책" 탭에서 직접 수정할 수 있습니다. 변경 사항은 새로 등록되는 티켓부터 적용됩니다.
          </div>
        </div>
      </section>

      {/* SLA 에스컬레이션 */}
      <section className="mb-10">
        <SectionTitle number="3" title="SLA 에스컬레이션 자동화" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <p className="text-sm text-gray-600 mb-4">
            SLA 체커 스레드(5분 주기)가 SLA 임박·위반 티켓을 감지하여 에스컬레이션 정책을 자동 실행합니다.
            EscalationRecord로 중복 실행을 방지합니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            {ESCALATION_ACTIONS.map((action) => (
              <div key={action.label} className="border border-orange-200 bg-orange-50 rounded-xl p-4">
                <div className="text-2xl mb-2">{action.icon}</div>
                <div className="font-semibold text-sm text-gray-800 mb-1">{action.label}</div>
                <p className="text-xs text-gray-600 leading-relaxed">{action.desc}</p>
              </div>
            ))}
          </div>
          <div className="bg-gray-50 border rounded-xl p-4">
            <h4 className="font-semibold text-sm text-gray-700 mb-3">정책 조합 예시</h4>
            <div className="space-y-2">
              {[
                { priority: '긴급', trigger: 'warning', delay: 0, action: '알림 발송', color: 'bg-red-100 text-red-700' },
                { priority: '높음', trigger: 'breach', delay: 30, action: '담당자 변경', color: 'bg-orange-100 text-orange-700' },
                { priority: '보통', trigger: 'breach', delay: 60, action: '우선순위 자동 상향', color: 'bg-yellow-100 text-yellow-700' },
              ].map((ex, i) => (
                <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                  <span className={`px-2 py-0.5 rounded font-bold ${ex.color}`}>{ex.priority}</span>
                  <span className="text-gray-500">+</span>
                  <span className="font-medium text-gray-700">{ex.trigger}</span>
                  <span className="text-gray-500">+</span>
                  <span className="text-gray-600">지연 {ex.delay}분</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-medium text-blue-600">{ex.action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SLA 배지 */}
      <section className="mb-10">
        <SectionTitle number="4" title="SLA 상태 배지" />
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { badge: '🟢 정상',   desc: 'SLA 기한까지 시간 여유 있음',          color: 'bg-green-50 border-green-300' },
              { badge: '🟡 주의',   desc: 'SLA 기한 1시간 이내 (사전 경고 알림)', color: 'bg-yellow-50 border-yellow-300' },
              { badge: '🟠 임박',   desc: 'SLA 기한 30분 이내',                   color: 'bg-orange-50 border-orange-300' },
              { badge: '🔴 위반',   desc: 'SLA 기한 초과됨',                      color: 'bg-red-50 border-red-300' },
            ].map((b) => (
              <div key={b.badge} className={`border-2 rounded-xl p-3 text-center ${b.color}`}>
                <div className="font-bold text-sm mb-1">{b.badge}</div>
                <div className="text-xs text-gray-600">{b.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 탭: 권한 & 비교 ────────────────────────────────────────────────── */

function TabRbac() {
  return (
    <>
      {/* 권한 매트릭스 */}
      <section className="mb-10">
        <SectionTitle number="1" title="기능별 권한 매트릭스" />
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 min-w-[220px]">기능</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 w-20">현업<br/>사용자</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 w-20">IT<br/>개발자</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 w-20">IT<br/>에이전트</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 w-20">IT<br/>관리자</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ROWS.map((row, i) => (
                  <tr key={row.feature} className={`border-b last:border-0 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                    <td className="py-2.5 px-4 text-gray-700 text-xs">
                      <span className="flex items-center gap-1.5">
                        {row.feature}
                        {row.isNew && <NewBadge />}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.user === '✅' ? 'text-green-600' : 'text-gray-300'}>{row.user}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.dev === '✅' ? 'text-green-600' : 'text-gray-300'}>{row.dev}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.agent === '✅' ? 'text-green-600' : 'text-gray-300'}>{row.agent}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.admin === '✅' ? 'text-green-600' : 'text-gray-300'}>{row.admin}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 비교 매트릭스 */}
      <section className="mb-10">
        <SectionTitle number="2" title="타 서비스 비교" />
        <p className="text-sm text-gray-500 mb-4">
          ✅ 기본 지원 · ⚠️ 제한적/설정 필요 · ❌ 미지원 · N/A 해당 없음
        </p>
        {COMPARISON_SECTIONS.map((section) => (
          <div key={section.category} className="bg-white rounded-xl border shadow-sm overflow-hidden mb-4">
            <div className="bg-gray-50 border-b px-4 py-2.5">
              <h3 className="font-bold text-sm text-gray-800">{section.category}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-4 text-xs font-semibold text-gray-500 min-w-[200px]">기능</th>
                    <th className="text-center py-2 px-2 text-xs font-bold text-blue-700 w-16">ZENITH</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 w-16">Zammad</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 w-16">GLPI</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 w-16">Jira</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 w-20">Service Now</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.feature} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 px-4 text-xs text-gray-700">
                        <span className="flex items-center gap-1.5">
                          {row.feature}
                          {row.isNew && <NewBadge />}
                        </span>
                      </td>
                      <ComparisonCell value={row.itsm} />
                      <ComparisonCell value={row.zammad} />
                      <ComparisonCell value={row.glpi} />
                      <ComparisonCell value={row.jira} />
                      <ComparisonCell value={row.sn} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </>
  )
}

/* ─── 탭: 성능 & 안정화 ──────────────────────────────────────────────── */

function TabPerf() {
  const SEVERITY_COLOR: Record<string, string> = {
    심각: 'bg-red-100 text-red-700 border-red-300',
    높음: 'bg-orange-100 text-orange-700 border-orange-300',
    중간: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    낮음: 'bg-blue-100 text-blue-700 border-blue-300',
    정보: 'bg-gray-100 text-gray-600 border-gray-300',
  }
  return (
    <>
      {/* 성능 개선 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">1</div>
          <h2 className="text-lg font-bold text-gray-800">성능 개선 — 티켓 목록 로드 최적화</h2>
        </div>
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <span className="font-semibold">측정 기준:</span> 32개 이슈, 캐시 미스 환경 (GitLab CE 동일 호스트)
        </div>
        <div className="space-y-4">
          {PERF_IMPROVEMENTS.map((item) => (
            <div key={item.title} className="bg-white rounded-xl border shadow-sm p-5">
              <div className="flex flex-wrap items-start gap-2 mb-3">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border">{item.category}</span>
                <h3 className="font-semibold text-gray-800 text-sm">{item.title}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 text-xs">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="text-red-600 font-semibold mb-1">개선 전</div>
                  <div className="text-red-800">{item.before}</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-green-600 font-semibold mb-1">개선 후</div>
                  <div className="text-green-800">{item.after}</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-blue-600 font-semibold mb-1">효과</div>
                  <div className="text-blue-800 font-medium">{item.saving}</div>
                </div>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 종합 성능 지표 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">2</div>
          <h2 className="text-lg font-bold text-gray-800">종합 성능 지표</h2>
        </div>
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                <th className="px-4 py-2.5 text-left">지표</th>
                <th className="px-4 py-2.5 text-center">개선 전</th>
                <th className="px-4 py-2.5 text-center">개선 후</th>
                <th className="px-4 py-2.5 text-center">개선율</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                { metric: '티켓 목록 초기 로드 (캐시 미스)', before: '272ms', after: '176ms', gain: '35% ↓' },
                { metric: '캐시 히트 시 응답', before: '5~8ms', after: '3~5ms', gain: '~40% ↓' },
                { metric: 'list_tickets JSON 응답 크기', before: '53KB', after: '5KB (gzip)', gain: '90% ↓' },
                { metric: 'stats 캐시 미스 빈도', before: '매 60초', after: '매 300초', gain: '5× 감소' },
                { metric: 'requesters 캐시 미스 빈도', before: '매 300초', after: '매 600초', gain: '2× 감소' },
                { metric: 'GitLab API TCP 연결 비용', before: '3.2ms/회 × ~8회', after: '풀 재사용', gain: '~22ms 절감' },
                { metric: 'DB Dead tuple (주요 테이블)', before: '최대 4100%', after: '0%', gain: '100% 제거' },
                { metric: '중복 DB 인덱스', before: '17개', after: '0개', gain: '전량 제거' },
                { metric: 'label_sync GitLab API 호출', before: '2회/분 (30s 주기)', after: '0.2회/분 (5분 쿨다운)', gain: '10× 감소' },
                { metric: 'API CPU 점유율 (SSE tight loop)', before: '100% 고착', after: '0.24% 안정', gain: '완전 해소' },
                { metric: '/health 응답 시간', before: '2~8초 (매번 GitLab API)', after: '3ms (60초 캐시)', gain: '99.9% ↓' },
                { metric: '타임라인 응답 시간 (캐시 히트)', before: '1.5~4초', after: '~17ms', gain: '99% ↓' },
                { metric: '서비스 유형 usage API', before: '22초 (GitLab 5회 직렬)', after: '즉시 (5분 캐시)', gain: '~22초 절감' },
                { metric: 'Prometheus scrape 간격', before: '15초', after: '60초', gain: '4× 부하 감소' },
              ].map((row) => (
                <tr key={row.metric} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-700">{row.metric}</td>
                  <td className="px-4 py-2.5 text-center text-red-600 font-mono text-xs">{row.before}</td>
                  <td className="px-4 py-2.5 text-center text-green-600 font-mono text-xs">{row.after}</td>
                  <td className="px-4 py-2.5 text-center font-semibold text-blue-600 text-xs">{row.gain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 안정화 수정 사항 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">3</div>
          <h2 className="text-lg font-bold text-gray-800">안정화 수정 사항</h2>
        </div>
        <div className="space-y-4">
          {STABILITY_FIXES.map((item) => (
            <div key={item.title} className="bg-white rounded-xl border shadow-sm p-5">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xl">{item.emoji}</span>
                <h3 className="font-semibold text-gray-800 text-sm flex-1">{item.title}</h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${SEVERITY_COLOR[item.severity]}`}>{item.severity}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="text-gray-500 font-semibold mb-1">증상</div>
                  <div className="text-gray-700">{item.symptom}</div>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <div className="text-orange-600 font-semibold mb-1">원인</div>
                  <div className="text-orange-800">{item.cause}</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-green-600 font-semibold mb-1">수정</div>
                  <div className="text-green-800">{item.fix}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 안정화 체크 결과 */}
      <section className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">4</div>
          <h2 className="text-lg font-bold text-gray-800">현재 시스템 상태</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { emoji: '✅', label: '모든 컨테이너', desc: '9개 Up (재시작 0회)' },
            { emoji: '✅', label: 'API 헬스체크', desc: 'DB·Redis·GitLab·label_sync all ok' },
            { emoji: '✅', label: 'Python 모듈', desc: '30개 정상 로드' },
            { emoji: '✅', label: 'TypeScript 타입', desc: '오류 없음' },
            { emoji: '✅', label: 'DB 마이그레이션', desc: '0041 (최신)' },
            { emoji: '✅', label: 'DB 제약조건', desc: '비정상 0건' },
            { emoji: '✅', label: 'Prometheus 스크레이프', desc: 'itsm-api: up' },
            { emoji: '✅', label: 'Grafana 대시보드', desc: '4개 자동 프로비저닝' },
            { emoji: '✅', label: '보안 헤더 7종', desc: 'CSP·HSTS·X-Frame 등' },
            { emoji: '✅', label: 'npm 취약점', desc: 'high/critical 없음 (low 4건)' },
            { emoji: '✅', label: '비즈니스 메트릭', desc: '27개 샘플 수집 중' },
            { emoji: '⚠️', label: 'SECRET_KEY', desc: '운영 배포 전 반드시 교체 필요' },
          ].map((item) => (
            <div key={item.label} className={`flex items-start gap-3 rounded-lg border p-3 ${item.emoji === '⚠️' ? 'bg-yellow-50 border-yellow-200' : 'bg-white'}`}>
              <span className="text-lg shrink-0">{item.emoji}</span>
              <div>
                <div className="font-semibold text-sm text-gray-800">{item.label}</div>
                <div className="text-xs text-gray-500">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/* ─── 탭: 아키텍처 ───────────────────────────────────────────────────── */

function TabArch() {
  return (
    <>
      {/* 기술 스택 버전 */}
      <section className="mb-10">
        <SectionTitle number="1" title="기술 스택 버전" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { name: 'Python',      version: '3.13',    emoji: '🐍', color: 'border-blue-200 bg-blue-50 text-blue-800' },
            { name: 'Next.js',     version: '15.5.x',  emoji: '⚛️', color: 'border-gray-200 bg-gray-50 text-gray-800' },
            { name: 'Node.js',     version: '22',      emoji: '🟢', color: 'border-green-200 bg-green-50 text-green-800' },
            { name: 'PostgreSQL',  version: '17',      emoji: '🐘', color: 'border-indigo-200 bg-indigo-50 text-indigo-800' },
            { name: 'Redis',       version: '7.4',     emoji: '🔴', color: 'border-red-200 bg-red-50 text-red-800' },
            { name: 'Nginx',       version: '1.27',    emoji: '🔀', color: 'border-green-200 bg-green-50 text-green-800' },
            { name: 'Alembic',     version: '41단계',  emoji: '📋', color: 'border-purple-200 bg-purple-50 text-purple-800' },
            { name: 'Prometheus',  version: 'latest',  emoji: '📊', color: 'border-orange-200 bg-orange-50 text-orange-800' },
            { name: 'Grafana',     version: 'latest',  emoji: '📈', color: 'border-purple-200 bg-purple-50 text-purple-800' },
            { name: 'ClamAV',      version: 'latest',  emoji: '🦠', color: 'border-red-200 bg-red-50 text-red-800' },
          ].map((tech) => (
            <div key={tech.name} className={`border-2 rounded-xl p-3 text-center ${tech.color}`}>
              <div className="text-xl mb-1">{tech.emoji}</div>
              <div className="font-bold text-xs">{tech.name}</div>
              <div className="text-xs opacity-75 mt-0.5">{tech.version}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 컴포넌트 상세 */}
      <section className="mb-10">
        <SectionTitle number="2" title="서비스 컴포넌트" />
        <div className="space-y-4">
          {SW_COMPONENTS.map((comp) => (
            <div key={comp.name} className={`border-2 rounded-xl overflow-hidden ${comp.border}`}>
              <div className={`px-5 py-3 flex items-center gap-3 ${comp.bg}`}>
                <span className="text-2xl">{comp.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800">{comp.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${comp.badge}`}>{comp.category}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{comp.version}</div>
                </div>
                <div className="text-xs font-medium text-gray-600 hidden md:block">{comp.role}</div>
              </div>
              <div className="bg-white px-5 py-4">
                <p className="text-sm text-gray-600 mb-3 leading-relaxed">{comp.desc}</p>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {comp.details.map((d) => (
                    <li key={d} className="text-xs text-gray-500 flex items-start gap-1.5">
                      <span className="text-blue-400 mt-0.5 shrink-0">▸</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 서비스 연결 */}
      <section className="mb-10">
        <SectionTitle number="3" title="서비스 간 연결 구조" />
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600">발신</th>
                  <th className="text-center py-2.5 px-3 font-semibold text-gray-600 w-8"></th>
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600">수신</th>
                  <th className="text-center py-2.5 px-3 font-semibold text-gray-600">프로토콜</th>
                  <th className="text-center py-2.5 px-3 font-semibold text-gray-600">포트</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 hidden md:table-cell">설명</th>
                </tr>
              </thead>
              <tbody>
                {CONNECTIONS.map((c, i) => (
                  <tr key={i} className={`border-b last:border-0 ${c.color}`}>
                    <td className="py-2 px-3 font-medium text-gray-700">{c.from}</td>
                    <td className="py-2 px-3 text-center text-gray-400 font-bold">{c.direction}</td>
                    <td className="py-2 px-3 font-medium text-gray-700">{c.to}</td>
                    <td className="py-2 px-3 text-center">
                      <span className="bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-600 font-mono">{c.protocol}</span>
                    </td>
                    <td className="py-2 px-3 text-center font-mono text-gray-500">{c.port}</td>
                    <td className="py-2 px-3 text-gray-500 hidden md:table-cell">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 환경 변수 요약 */}
      <section className="mb-10">
        <SectionTitle number="4" title="주요 환경변수" />
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { key: 'MAX_ACTIVE_SESSIONS', default: '5', desc: '계정당 동시 활성 세션 최대 수' },
              { key: 'CLAMAV_ENABLED', default: 'true', desc: 'ClamAV 바이러스 스캔 활성화' },
              { key: 'USER_SYNC_INTERVAL', default: '3600', desc: 'GitLab 사용자 동기화 주기 (초)' },
              { key: 'IMAP_ENABLED', default: 'false', desc: 'IMAP 이메일 → 티켓 자동 변환' },
              { key: 'GRAFANA_PASSWORD', default: '—', desc: 'Grafana 관리자 비밀번호' },
              { key: 'REDIS_PASSWORD', default: '—', desc: 'Redis requirepass 인증 비밀번호' },
              { key: 'IMAP_POLL_INTERVAL', default: '60', desc: 'IMAP 폴링 주기 (초)' },
              { key: 'TELEGRAM_BOT_TOKEN', default: '—', desc: 'Telegram 알림 봇 토큰' },
            ].map((env) => (
              <div key={env.key} className="bg-gray-50 rounded-lg border border-gray-200 p-3 flex items-start gap-3">
                <code className="text-xs font-mono bg-white border border-gray-300 px-2 py-1 rounded text-blue-700 shrink-0">{env.key}</code>
                <div>
                  <div className="text-xs text-gray-600">{env.desc}</div>
                  <div className="text-xs text-gray-400 mt-0.5">기본값: {env.default}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 탭: API 문서 ───────────────────────────────────────────────────── */

function TabApi() {
  const [openGroup, setOpenGroup] = useState<string | null>('tickets')

  return (
    <>
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">📖</span>
          <div>
            <div className="font-semibold text-blue-800 text-sm mb-1">전체 API 명세 (Swagger)</div>
            <p className="text-xs text-blue-600 mb-2">
              Swagger UI(<Link href="http://localhost:8111/docs" target="_blank" rel="noopener noreferrer" className="underline">http://localhost:8111/docs</Link>)에서
              모든 엔드포인트를 직접 테스트할 수 있습니다. 인증이 필요한 엔드포인트는 로그인 후 쿠키가 자동 포함됩니다.
            </p>
            <div className="text-xs text-blue-700">
              <span className="font-medium">API 키 인증:</span> Authorization: Bearer itsm_live_xxxx 헤더 사용 (외부 시스템 연동)
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {API_GROUPS.map((group) => {
          const isOpen = openGroup === group.id
          return (
            <div key={group.id} className={`border-2 rounded-xl overflow-hidden ${group.border}`}>
              <button
                type="button"
                className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:opacity-90 ${group.bg}`}
                onClick={() => setOpenGroup(isOpen ? null : group.id)}
                aria-expanded={isOpen}
              >
                <span className="text-xl">{group.emoji}</span>
                <div className="flex-1">
                  <span className={`font-bold text-sm ${group.color}`}>{group.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{group.endpoints.length}개 엔드포인트</span>
                </div>
                <span className="text-gray-400 text-lg">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="bg-white divide-y divide-gray-100">
                  {group.endpoints.map((ep) => (
                    <div key={`${ep.method}-${ep.path}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 transition-colors">
                      <MethodBadge method={ep.method} />
                      <code className="text-xs font-mono text-gray-600 flex-1 min-w-0 truncate">{ep.path}</code>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {ep.isNew && <NewBadge />}
                        <span className="text-xs text-gray-500 hidden md:block max-w-xs truncate">{ep.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 인증 방법 요약 */}
      <section className="mt-8 mb-10">
        <SectionTitle number="2" title="인증 방법 요약" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="font-semibold text-sm text-gray-800 mb-2">🍪 JWT 쿠키 (웹 로그인)</div>
            <p className="text-xs text-gray-600 mb-3">GitLab OAuth 로그인 후 itsm_token 쿠키가 자동 설정됩니다. 브라우저 요청에 자동 포함되며 2시간마다 Refresh Token으로 갱신됩니다.</p>
            <div className="bg-gray-900 rounded-lg p-2">
              <code className="text-xs text-green-400 font-mono">Cookie: itsm_token=eyJ...</code>
            </div>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-sm text-gray-800">🔑 API 키 (외부 시스템)</span>
              <NewBadge />
            </div>
            <p className="text-xs text-gray-600 mb-3">관리자가 발급한 API 키를 Bearer 토큰으로 사용합니다. 스코프 기반 권한 제어 및 SHA-256 해시 저장.</p>
            <div className="bg-gray-900 rounded-lg p-2">
              <code className="text-xs text-green-400 font-mono">Authorization: Bearer itsm_live_xxxx</code>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 탭: 업무 프로세스 ──────────────────────────────────────────────── */

const PROCESS_ROLES = [
  {
    role: '현업',
    color: 'bg-blue-50 border-blue-300 text-blue-800',
    badge: 'bg-blue-100 text-blue-700',
    itsmRole: 'user',
    actions: ['요청 등록', '테스트 수행', '최종 완료 처리'],
    screens: ['포털 (/portal)', '티켓 상세'],
  },
  {
    role: 'IT팀',
    color: 'bg-purple-50 border-purple-300 text-purple-800',
    badge: 'bg-purple-100 text-purple-700',
    itsmRole: 'agent / admin',
    actions: ['요청 승인 (담당자 배정)', '테스트 완료 전달', '운영 배포 승인 (GitLab MR)', '최종 확인'],
    screens: ['티켓 목록', '티켓 상세', 'GitLab MR'],
  },
  {
    role: '협력사 PL',
    color: 'bg-teal-50 border-teal-300 text-teal-800',
    badge: 'bg-teal-100 text-teal-700',
    itsmRole: 'agent',
    actions: ['Issue 생성 (개발 전달)', 'feature 브랜치 생성', 'MR 승인 (main)', '개발기/테스트기 태그 생성', 'release MR 생성'],
    screens: ['티켓 상세 → 개발 전달', 'GitLab 직접'],
  },
  {
    role: '협력사 개발자',
    color: 'bg-orange-50 border-orange-300 text-orange-800',
    badge: 'bg-orange-100 text-orange-700',
    itsmRole: 'developer',
    actions: ['기능 개발', '로컬 검증', 'MR 생성 (main)'],
    screens: ['티켓 목록 (본인 할당분)', 'GitLab 직접'],
  },
  {
    role: 'GitLab 시스템',
    color: 'bg-gray-50 border-gray-300 text-gray-700',
    badge: 'bg-gray-100 text-gray-600',
    itsmRole: '—',
    actions: ['브랜치 생성', '빌드/테스트 자동화', '서버 배포 (CI/CD)', 'ITSM 웹훅 이벤트 전달'],
    screens: ['GitLab CI/CD 파이프라인'],
  },
]

const TERM_MAP = [
  { term: 'Epic (상위 단위, 현업 요청)', itsm: 'ITSM 티켓', note: 'GitLab ITSM 프로젝트 Issue', color: 'bg-blue-50 border-blue-200' },
  { term: 'Issue (하위 단위, 개발 작업)', itsm: '개발 전달 이슈', note: 'GitLab 개발 프로젝트 Issue (개발 전달 기능)', color: 'bg-teal-50 border-teal-200' },
  { term: 'Epic: open',              itsm: '티켓 상태 · 접수됨',       note: 'status::open',              color: 'bg-yellow-50 border-yellow-200' },
  { term: 'Epic: approved',          itsm: '티켓 상태 · 승인완료',     note: 'status::approved',          color: 'bg-teal-50 border-teal-200' },
  { term: 'Epic: in-progress',       itsm: '티켓 상태 · 처리중',       note: 'status::in_progress',       color: 'bg-blue-50 border-blue-200' },
  { term: 'Epic: testing',           itsm: '티켓 상태 · 대기중',       note: 'status::waiting (SLA 자동 일시정지)', color: 'bg-purple-50 border-purple-200' },
  { term: 'Epic: resolved',          itsm: '티켓 상태 · 처리완료',     note: 'status::resolved',          color: 'bg-green-50 border-green-200' },
  { term: 'Epic: ready-for-release', itsm: '티켓 상태 · 운영배포전',   note: 'status::ready_for_release', color: 'bg-amber-50 border-amber-200' },
  { term: 'Epic: released',          itsm: '티켓 상태 · 운영반영완료', note: 'status::released',          color: 'bg-indigo-50 border-indigo-200' },
  { term: 'Epic: done',              itsm: '티켓 Closed',              note: 'GitLab issue closed',       color: 'bg-slate-50 border-slate-200' },
]

type ProcessStep = {
  id: string
  phase: string
  title: string
  actor: string
  actorColor: string
  gitlabDirect?: boolean
  steps: { who: string; color: string; action: string; detail: string; code?: string }[]
  note?: string
}

const PROCESS_STEPS: ProcessStep[] = [
  {
    id: '4-1',
    phase: '4.1',
    title: '요청 등록 및 승인',
    actor: '현업 → IT팀 → 협력사 PL',
    actorColor: 'text-blue-700',
    steps: [
      { who: '현업', color: 'bg-blue-100 text-blue-800', action: '요청 등록', detail: '포털(/) 또는 티켓 등록에서 서비스 유형·제목·내용·우선순위 입력 후 제출 → 티켓 생성 (상태: 접수됨/open)' },
      { who: 'IT팀', color: 'bg-purple-100 text-purple-800', action: '검토 및 승인', detail: '티켓 상세 → 댓글로 승인 의사 기록 → 담당자(협력사 PL) 배정 → 상태를 승인완료로 변경 (이후 협력사 PL이 처리중으로 전환)', code: '티켓 담당자 드롭다운 → 협력사 PL 선택 → 상태 "승인완료(approved)"로 변경' },
      { who: '협력사 PL', color: 'bg-teal-100 text-teal-800', action: '개발 전달 (Issue 생성)', detail: '티켓 상세 → 사이드바 "전달" 탭 → 대상 개발 프로젝트 선택 → 작업 내용·담당자 입력 → 전달', code: '티켓 상세 우측 → 개발 전달 탭 → "전달하기" 버튼' },
      { who: 'GitLab', color: 'bg-gray-100 text-gray-700', action: 'feature 브랜치 생성', detail: 'GitLab 개발 프로젝트 → Issues → 해당 Issue → "Create branch" 버튼 → feature/이슈번호-설명 형식', code: 'GitLab > Issues > Create branch' },
    ],
  },
  {
    id: '4-2',
    phase: '4.2',
    title: '기능 개발 및 로컬 검증',
    actor: '협력사 개발자',
    actorColor: 'text-orange-700',
    gitlabDirect: true,
    steps: [
      { who: '협력사 개발자', color: 'bg-orange-100 text-orange-800', action: 'feature 브랜치 checkout', detail: '로컬에서 feature 브랜치를 내려받아 개발 시작', code: 'git checkout feature/이슈번호-설명' },
      { who: '협력사 개발자', color: 'bg-orange-100 text-orange-800', action: '기능 개발 및 커밋', detail: '기능 개발 완료 후 커밋 메시지에 이슈 번호 포함 → ITSM 자동 참조 댓글 등록', code: 'git commit -m "feat: 기능 설명 (#이슈번호)"\ngit push origin feature/이슈번호-설명' },
    ],
    note: '커밋 메시지에 "#이슈번호" 포함 시 ITSM 티켓에 커밋 링크가 자동 기록됩니다.',
  },
  {
    id: '4-3',
    phase: '4.3',
    title: 'main 반영 (MR 생성 → 승인 → 병합)',
    actor: '협력사 개발자 → 협력사 PL → GitLab',
    actorColor: 'text-orange-700',
    gitlabDirect: true,
    steps: [
      { who: '협력사 개발자', color: 'bg-orange-100 text-orange-800', action: 'MR 생성 (feature → main)', detail: 'GitLab → Merge Requests → New → source: feature/... → target: main → Assignee: 협력사 PL', code: 'GitLab > MR > New MR\nsource: feature/... → target: main' },
      { who: 'GitLab', color: 'bg-gray-100 text-gray-700', action: 'CI 자동 실행', detail: 'MR 생성 트리거 → lint + test 파이프라인 자동 실행', code: '.gitlab-ci.yml → rules-lint-test' },
      { who: '협력사 PL', color: 'bg-teal-100 text-teal-800', action: 'MR 코드 리뷰 및 승인·병합', detail: 'GitLab → MR 상세 → 코드 리뷰 → "Approve" → "Merge" → feature 브랜치 자동 삭제', code: 'GitLab MR > Approve > Merge' },
      { who: 'GitLab → ITSM', color: 'bg-gray-100 text-gray-700', action: 'Issue 자동 Closed', detail: 'MR 병합 → 웹훅 이벤트 → ITSM 개발 전달 이슈 상태 자동 업데이트 (MR 설명에 "Closes #N" 포함 시 티켓도 resolved 자동 전환)', code: 'MR 설명: "Closes #N" → 티켓 자동 resolved' },
    ],
  },
  {
    id: '4-4',
    phase: '4.4',
    title: '개발기 배포 및 확인',
    actor: '협력사 PL',
    actorColor: 'text-teal-700',
    gitlabDirect: true,
    steps: [
      { who: '협력사 PL', color: 'bg-teal-100 text-teal-800', action: '개발기 배포 태그 생성', detail: 'GitLab → 개발 프로젝트 → Repository → Tags → New tag → dev-YYYYMMDD → Create from: main', code: 'Tag name: dev-20260313\nCreate from: main 브랜치' },
      { who: 'GitLab', color: 'bg-gray-100 text-gray-700', action: '개발기 자동 배포', detail: 'dev-* 태그 트리거 → build:api + build:web → deploy:dev → healthcheck 자동 실행', code: 'CI/CD: deploy:dev 자동 실행' },
      { who: '협력사 PL', color: 'bg-teal-100 text-teal-800', action: 'ITSM 확인 기록', detail: 'ITSM 티켓 → 댓글: "개발기 배포 완료. 확인 요청드립니다."', code: '티켓 댓글 등록' },
    ],
  },
  {
    id: '4-5',
    phase: '4.5',
    title: '테스트기 배포 및 테스트',
    actor: '협력사 PL → IT팀 → 현업',
    actorColor: 'text-teal-700',
    gitlabDirect: true,
    steps: [
      { who: '협력사 PL', color: 'bg-teal-100 text-teal-800', action: '테스트기 배포 태그 생성', detail: 'GitLab → Tags → New tag → stg-YYYYMMDD → Create from: main', code: 'Tag name: stg-20260313\nCreate from: main 브랜치' },
      { who: 'GitLab', color: 'bg-gray-100 text-gray-700', action: '테스트기 자동 배포', detail: 'stg-* 태그 트리거 → build → deploy:staging → healthcheck 자동 실행', code: 'CI/CD: deploy:staging 자동 실행' },
      { who: 'IT팀', color: 'bg-purple-100 text-purple-800', action: '현업에 테스트 요청', detail: 'ITSM 티켓 → 댓글로 안내 → 상태를 "대기중(waiting)"으로 변경 (SLA 자동 일시정지)', code: '상태 → 대기중(waiting)으로 변경' },
      { who: '현업', color: 'bg-blue-100 text-blue-800', action: '테스트기에서 테스트 수행', detail: 'ITSM 포털 → 내 요청 → 해당 티켓 → 테스트 후 댓글로 결과 전달', code: '티켓 댓글: "테스트 완료 확인했습니다."' },
      { who: 'IT팀', color: 'bg-purple-100 text-purple-800', action: '테스트 확인 완료 처리', detail: 'ITSM 티켓 → 상태를 "운영배포전(ready_for_release)"으로 변경 (운영 배포 준비 완료 신호)', code: '상태 → 운영배포전(ready_for_release)으로 변경' },
    ],
  },
  {
    id: '4-6',
    phase: '4.6',
    title: 'release 반영 (운영 브랜치)',
    actor: '협력사 PL → IT팀',
    actorColor: 'text-teal-700',
    gitlabDirect: true,
    steps: [
      { who: '협력사 PL', color: 'bg-teal-100 text-teal-800', action: 'MR 생성 (main → release)', detail: 'GitLab → Merge Requests → New → source: main → target: release → Assignee: IT팀', code: 'GitLab > MR > New\nsource: main → target: release' },
      { who: 'GitLab', color: 'bg-gray-100 text-gray-700', action: 'CI 자동 실행', detail: 'release 브랜치 대상 lint + test 파이프라인 자동 실행', code: 'CI/CD: lint + test 자동 실행' },
      { who: 'IT팀', color: 'bg-purple-100 text-purple-800', action: 'release MR 승인·병합', detail: 'GitLab → MR 상세 → 코드 리뷰 → "Approve" → "Merge" → release 브랜치에 main 병합 완료', code: 'GitLab MR > Approve > Merge' },
    ],
  },
  {
    id: '4-7',
    phase: '4.7',
    title: '운영 배포 및 종료',
    actor: 'IT팀 → 현업',
    actorColor: 'text-purple-700',
    gitlabDirect: true,
    steps: [
      { who: 'IT팀', color: 'bg-purple-100 text-purple-800', action: '운영 배포 태그 생성', detail: 'GitLab → release 브랜치 → Tags → New tag → v1.2.3 형식으로 생성', code: 'Tag name: v0.1.0\nCreate from: release 브랜치' },
      { who: 'GitLab', color: 'bg-gray-100 text-gray-700', action: 'CI: deploy:production 대기', detail: 'v*.*.* 태그 트리거 → build 완료 → deploy:production 잡이 수동(manual) 상태로 대기', code: 'CI/CD > Pipelines > deploy:production ▶ 클릭' },
      { who: 'IT팀', color: 'bg-purple-100 text-purple-800', action: '운영 배포 수동 승인', detail: 'GitLab → CI/CD → Pipelines → 해당 파이프라인 → deploy:production → ▶ 실행 버튼 클릭', code: 'GitLab Pipelines > ▶ deploy:production' },
      { who: 'IT팀', color: 'bg-purple-100 text-purple-800', action: '운영 배포 확인 및 ITSM 기록', detail: 'ITSM 티켓 → 댓글: "운영 배포 완료. 확인 요청드립니다." → 상태를 "운영반영완료(released)"로 변경', code: '상태 → 운영반영완료(released)로 변경 후 댓글 등록' },
      { who: '현업', color: 'bg-blue-100 text-blue-800', action: '최종 완료 처리', detail: 'ITSM 포털 → 해당 티켓 → 완료 처리 → 티켓 Closed (Epic: done)', code: '티켓 상태 → 종료(closed)' },
    ],
  },
]

const STATUS_GAP_ROWS = [
  { desired: 'open (요청등록)',            itsm: '접수됨 (open)',                  match: true,  note: '' },
  { desired: 'approved (승인완료)',         itsm: '승인완료 (approved)',            match: true,  note: '' },
  { desired: 'in-progress (개발진행)',      itsm: '처리중 (in_progress)',           match: true,  note: '동일 상태 사용' },
  { desired: 'testing (테스트)',            itsm: '대기중 (waiting)',               match: false, note: 'SLA 자동 일시정지. testing 전용 상태 없음' },
  { desired: 'ready-for-release (운영배포전)', itsm: '운영배포전 (ready_for_release)', match: true, note: '' },
  { desired: 'released (운영반영완료)',     itsm: '운영반영완료 (released)',        match: true,  note: '' },
  { desired: 'done (종료)',                 itsm: '종료 (closed)',                  match: true,  note: '' },
]

function ProcessStepCard({ step, index }: { step: ProcessStep; index: number }) {
  const [open, setOpen] = useState(index === 0)
  return (
    <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
      <button
        type="button"
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
          {step.phase}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800">{step.title}</div>
          <div className={`text-xs mt-0.5 font-medium ${step.actorColor}`}>{step.actor}</div>
        </div>
        {step.gitlabDirect && (
          <span className="shrink-0 text-xs bg-orange-100 text-orange-700 border border-orange-200 rounded px-2 py-0.5">GitLab 직접</span>
        )}
        <span className="text-gray-400 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t bg-gray-50">
          <div className="space-y-3 mt-4">
            {step.steps.map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-5 h-5 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center text-xs font-bold text-blue-600 shrink-0">
                    {i + 1}
                  </div>
                  {i < step.steps.length - 1 && <div className="w-0.5 flex-1 bg-blue-100 my-1 min-h-[12px]" />}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.color}`}>{s.who}</span>
                    <span className="text-sm font-semibold text-gray-800">{s.action}</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{s.detail}</p>
                  {s.code && (
                    <pre className="mt-2 text-xs bg-gray-800 text-green-300 rounded-lg px-3 py-2 font-mono whitespace-pre-wrap leading-relaxed">{s.code}</pre>
                  )}
                </div>
              </div>
            ))}
          </div>
          {step.note && (
            <div className="mt-3 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <span className="text-blue-500 text-xs shrink-0 mt-0.5">💡</span>
              <p className="text-xs text-blue-700 leading-relaxed">{step.note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TabProcess() {
  return (
    <>
      {/* 개요 */}
      <section className="mb-8">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white">
          <h2 className="text-lg font-bold mb-2">🔄 전체 업무 프로세스</h2>
          <p className="text-sm text-blue-100 leading-relaxed">
            현업 요청 등록부터 개발 · 테스트 · 운영 반영 · 종료까지의 전체 흐름입니다.
            <strong className="text-white"> Epic(요청 단위)</strong>은 ITSM 티켓으로,
            <strong className="text-white"> Issue(개발 작업 단위)</strong>는 개발 전달 이슈로 관리합니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {['요청 등록', '승인', '개발', 'main 반영', '개발기 배포', '테스트기 배포', 'release 반영', '운영 배포', '종료'].map((s, i, arr) => (
              <span key={s} className="flex items-center gap-1">
                <span className="bg-white/20 rounded px-2 py-0.5 font-medium">{s}</span>
                {i < arr.length - 1 && <span className="text-blue-300">→</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 참여 주체 역할 */}
      <section className="mb-8">
        <SectionTitle number="1" title="참여 주체 및 역할" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {PROCESS_ROLES.map((r) => (
            <div key={r.role} className={`rounded-xl border-2 p-4 ${r.color}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-bold text-base">{r.role}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-mono font-bold ${r.badge}`}>{r.itsmRole}</span>
              </div>
              <ul className="space-y-1 mb-3">
                {r.actions.map((a) => (
                  <li key={a} className="text-xs flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">·</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-current/20 pt-2 mt-2">
                <p className="text-xs opacity-70 font-medium">주요 화면</p>
                <p className="text-xs opacity-90 mt-0.5">{r.screens.join(' · ')}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 용어 매핑 */}
      <section className="mb-8">
        <SectionTitle number="2" title="용어 매핑 (Epic · Issue ↔ ITSM)" />
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-3 bg-gray-100 px-4 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
            <span>프로세스 용어</span>
            <span>ITSM 구현체</span>
            <span>상세</span>
          </div>
          {TERM_MAP.map((row, i) => (
            <div key={i} className={`grid grid-cols-3 px-4 py-3 text-sm border-t ${row.color}`}>
              <span className="font-medium text-gray-800 leading-snug pr-2">{row.term}</span>
              <span className="font-semibold text-gray-900 pr-2">{row.itsm}</span>
              <span className="text-gray-500 text-xs leading-snug">{row.note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 단계별 프로세스 */}
      <section className="mb-8">
        <SectionTitle number="3" title="단계별 프로세스 (아코디언)" />
        <p className="text-sm text-gray-500 mb-4">각 단계를 클릭하면 상세 수행 방법을 확인합니다.</p>
        <div className="space-y-3">
          {PROCESS_STEPS.map((step, i) => (
            <ProcessStepCard key={step.id} step={step} index={i} />
          ))}
        </div>
      </section>

      {/* 브랜치 전략 */}
      <section className="mb-8">
        <SectionTitle number="4" title="브랜치 · 태그 전략" />
        <div className="bg-white border rounded-xl shadow-sm p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            {[
              { branch: 'feature/*', color: 'border-orange-400 bg-orange-50', textColor: 'text-orange-800', badge: 'bg-orange-100 text-orange-700', desc: '개별 기능 개발용. GitLab Issue에서 생성. 개발 완료 후 main으로 MR.', from: 'Issue', to: 'main' },
              { branch: 'main',      color: 'border-blue-400 bg-blue-50',    textColor: 'text-blue-800',   badge: 'bg-blue-100 text-blue-700',   desc: '통합 개발 기준 브랜치. 개발기/테스트기 배포 기준. 검증 후 release로 MR.', from: 'feature/*', to: 'release' },
              { branch: 'release',   color: 'border-green-400 bg-green-50',  textColor: 'text-green-800',  badge: 'bg-green-100 text-green-700', desc: '운영 반영 기준 브랜치. v*.*.* 태그를 이 브랜치에서 생성.', from: 'main', to: '운영 서버' },
            ].map((b) => (
              <div key={b.branch} className={`rounded-xl border-2 p-4 ${b.color}`}>
                <code className={`font-bold text-base font-mono ${b.textColor}`}>{b.branch}</code>
                <p className={`text-xs mt-2 leading-relaxed ${b.textColor} opacity-90`}>{b.desc}</p>
                <div className="mt-3 flex items-center gap-1 text-xs">
                  <span className={`px-2 py-0.5 rounded font-mono ${b.badge}`}>{b.from}</span>
                  <span className="text-gray-400">→</span>
                  <span className={`px-2 py-0.5 rounded font-mono ${b.badge}`}>{b.to}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t pt-4">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">배포 태그 규칙</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { tag: 'dev-YYYYMMDD', env: '개발기', auto: true, color: 'bg-cyan-50 border-cyan-300 text-cyan-800', badge: 'bg-cyan-100 text-cyan-700', who: '협력사 PL', from: 'main' },
                { tag: 'stg-YYYYMMDD', env: '테스트기', auto: true, color: 'bg-yellow-50 border-yellow-300 text-yellow-800', badge: 'bg-yellow-100 text-yellow-700', who: '협력사 PL', from: 'main' },
                { tag: 'v1.2.3',       env: '운영기', auto: false, color: 'bg-red-50 border-red-300 text-red-800', badge: 'bg-red-100 text-red-700', who: 'IT팀', from: 'release' },
              ].map((t) => (
                <div key={t.tag} className={`rounded-lg border p-3 ${t.color}`}>
                  <code className="font-bold font-mono text-sm">{t.tag}</code>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.badge}`}>{t.env}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${t.badge}`}>{t.auto ? '🤖 자동 배포' : '👆 수동 승인'}</span>
                  </div>
                  <p className="text-xs mt-2 opacity-80">생성자: {t.who} · {t.from} 브랜치에서</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Epic 상태 vs ITSM 상태 */}
      <section className="mb-8">
        <SectionTitle number="5" title="Epic 상태 흐름 ↔ ITSM 티켓 상태" />
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-12 bg-gray-100 px-4 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
            <span className="col-span-4">프로세스 Epic 상태</span>
            <span className="col-span-4">ITSM 티켓 상태</span>
            <span className="col-span-1 text-center">일치</span>
            <span className="col-span-3">비고</span>
          </div>
          {STATUS_GAP_ROWS.map((row, i) => (
            <div key={i} className="grid grid-cols-12 px-4 py-3 text-sm border-t items-start">
              <span className="col-span-4 font-medium text-gray-800 leading-snug pr-2">{row.desired}</span>
              <span className="col-span-4 font-semibold text-gray-900 pr-2">{row.itsm}</span>
              <span className="col-span-1 text-center text-base">{row.match ? '✅' : '⚠️'}</span>
              <span className="col-span-3 text-xs text-gray-500 leading-snug">{row.note}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-amber-500 shrink-0 mt-0.5 text-base">⚠️</span>
          <div className="text-sm text-amber-800 leading-relaxed">
            <strong>현재 시스템 한계:</strong> <code className="bg-amber-100 px-1 rounded text-xs">approved</code> · <code className="bg-amber-100 px-1 rounded text-xs">ready-for-release</code> · <code className="bg-amber-100 px-1 rounded text-xs">released</code> 상태가 없어 인접 상태로 대체합니다.
            이 상태들을 정식 추가하려면 백엔드 <code className="bg-amber-100 px-1 rounded text-xs">STATUS_LABELS</code> 확장 + 상태 전환 규칙 수정이 필요합니다.
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 탭: FAQ ────────────────────────────────────────────────────────── */

function TabFaq() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  return (
    <div className="space-y-2">
      {FAQ_ITEMS.map((item, i) => {
        const isOpen = openIdx === i
        return (
          <div key={i} className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <button
              type="button"
              className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors min-h-[44px]"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <span className="text-blue-500 font-bold text-sm shrink-0 mt-0.5">Q.</span>
              <span className="flex-1 font-medium text-sm text-gray-800 leading-relaxed">{item.q}</span>
              <span className="text-gray-400 shrink-0 mt-0.5">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="px-5 pb-4 border-t border-gray-100 pt-3">
                <div className="flex gap-3">
                  <span className="text-teal-500 font-bold text-sm shrink-0">A.</span>
                  <p className="text-sm text-gray-600 leading-relaxed">{item.a}</p>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── 메인 페이지 컴포넌트 ───────────────────────────────────────────── */

export default function HelpPage() {
  const [activeTab, setActiveTab] = useState<TabId>('start')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b shadow-sm">
        <div className="w-full px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">ZENITH 도움말</h1>
          <p className="text-sm text-gray-500">IT 서비스 관리 플랫폼 사용 안내 및 기술 문서</p>
        </div>

        {/* 탭 네비게이션 — sticky, 모바일 스크롤 */}
        <div className="w-full px-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`
                  shrink-0 px-4 py-3 text-sm font-medium rounded-t-lg transition-colors min-h-[44px]
                  ${activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }
                `}
                aria-selected={activeTab === tab.id}
                role="tab"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="w-full px-4 py-8">
        {activeTab === 'start'    && <TabStart />}
        {activeTab === 'features' && <TabFeatures />}
        {activeTab === 'process'  && <TabProcess />}
        {activeTab === 'workflow' && <TabWorkflow />}
        {activeTab === 'rbac'     && <TabRbac />}
        {activeTab === 'perf'     && <TabPerf />}
        {activeTab === 'arch'     && <TabArch />}
        {activeTab === 'api'      && <TabApi />}
        {activeTab === 'faq'      && <TabFaq />}
      </div>

      {/* 푸터 */}
      <div className="border-t bg-white mt-8">
        <div className="w-full px-4 py-6 text-center text-xs text-gray-400 space-y-1">
          <div>
            <Link href="http://localhost:8111/docs" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Swagger UI</Link>
            {' · '}
            <Link href="http://localhost:8111/redoc" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">ReDoc</Link>
            {' · '}
            <Link href="http://localhost:9090" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Prometheus</Link>
            {' · '}
            <Link href="http://localhost:3001" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Grafana</Link>
          </div>
          <div>ZENITH · Python 3.13 · FastAPI 0.135 · Next.js 15 · PostgreSQL 17 · Redis 7.4 · Alembic 41단계</div>
        </div>
      </div>
    </div>
  )
}
