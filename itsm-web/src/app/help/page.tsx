'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { fetchFaqItems, type FaqItem as ApiFaqItem } from '@/lib/api'

/* ─── 탭 정의 ──────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'start',    label: '시작하기' },
  { id: 'features', label: '기능 안내' },
  { id: 'process',  label: '업무 프로세스' },
  { id: 'workflow', label: '워크플로우 & SLA' },
  { id: 'rbac',     label: '권한 & 비교' },
  { id: 'workload', label: '업무 현황 & 성과' },
  { id: 'perf',     label: '성능 & 안정화' },
  { id: 'arch',     label: '아키텍처' },
  { id: 'api',      label: 'API 문서' },
  { id: 'faq',      label: 'FAQ' },
  { id: 'about',    label: 'ZENITH 소개' },
] as const
type TabId = typeof TABS[number]['id']

/* ─── 공통 데이터 ─────────────────────────────────────────────────────── */

const QUICK_LINKS = [
  { href: '/tickets/new', emoji: '🎫', label: '티켓 등록',    desc: '새 IT 지원 요청',      color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 text-blue-700 dark:text-blue-300' },
  { href: '/portal',      emoji: '🌐', label: '고객 포털',    desc: '비로그인 접수',         color: 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 text-teal-700 dark:text-teal-300' },
  { href: '/kanban',      emoji: '🗂️', label: '칸반 보드',    desc: '드래그앤드롭 관리',     color: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 text-purple-700 dark:text-purple-300' },
  { href: '/kb',          emoji: '📚', label: '지식베이스',   desc: '자가 해결 검색',        color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 text-green-700 dark:text-green-300' },
  { href: '/reports',     emoji: '📊', label: '리포트',       desc: '현황·성과 분석',        color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 text-orange-700 dark:text-orange-300' },
  { href: 'http://localhost:8111/docs', emoji: '📖', label: 'Swagger UI', desc: 'API 명세 확인', color: 'border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-900/20 hover:bg-pink-100 text-pink-700' },
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
  { emoji: '🖥️', label: '하드웨어',   color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800', examples: ['PC·노트북 부팅 불가', '모니터 화면 이상', '프린터 인쇄 오류', '장비 교체·대여 요청'] },
  { emoji: '💻', label: '소프트웨어', color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',       examples: ['프로그램 설치 요청', '업무용 앱 오류', 'OS 업데이트 문제', '소프트웨어 개발·유지보수'] },
  { emoji: '🌐', label: '네트워크',   color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800', examples: ['인터넷 연결 불가', 'VPN 접속 오류', '공유폴더 접근 불가', '무선 Wi-Fi 문제'] },
  { emoji: '👤', label: '계정/권한',  color: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800',     examples: ['비밀번호 초기화', '시스템 접근 권한 요청', '계정 잠금 해제', '신규 계정 생성'] },
  { emoji: '📋', label: '기타',       color: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700',     examples: ['위 카테고리에 해당하지 않는 IT 지원', '장비 이전·설치 요청'] },
]

/* ─── 기능 안내 데이터 ────────────────────────────────────────────────── */

const ALL_FEATURES: { emoji: string; title: string; note: string; desc: string; isNew?: boolean }[] = [
  { emoji: '🎫', title: '티켓 CRUD + 파일 첨부',              note: '현업 사용자 이상',                                      desc: '티켓 생성·조회·수정과 스크린샷·로그 파일 첨부(최대 10MB)를 지원합니다. 파일은 매직바이트로 형식을 검증합니다.' },
  { emoji: '🔎', title: '글로벌 티켓 검색 (⌘K)',              note: '로그인 사용자 전체',                                    desc: '헤더 검색창 또는 ⌘K(Ctrl+K) 단축키로 전체 티켓을 실시간 검색합니다. GitLab 이슈 검색 API를 활용해 제목·설명을 대상으로 검색하며 300ms 디바운스로 자동완성됩니다. 화살표 키 탐색 및 Enter 선택, Esc로 닫기를 지원합니다.' },
  { emoji: '⌨️', title: '키보드 단축키',                      note: '로그인 사용자 전체',                                    desc: 'g+t(티켓 목록), g+k(칸반), g+b(지식베이스), g+r(리포트), g+a(관리), n(새 티켓 등록), ?(단축키 도움말). 입력 필드에서는 자동 비활성화됩니다.', isNew: true },
  { emoji: '🗂️', title: '칸반 보드',                          note: 'IT 개발자 이상 · /kanban',                             desc: '9개 상태 컬럼(접수됨·승인완료·처리중·대기중·처리완료·테스트중·운영배포전·운영반영완료·종료)을 드래그앤드롭으로 티켓 상태를 직접 변경합니다. 우선순위·담당자 필터로 원하는 카드만 표시하고, SLA 초과 카드는 빨간색(⚠️), 여유 카드는 초록색으로 구분합니다.' },
  { emoji: '📁', title: '칸반 종료됨 컬럼 접기/펼치기',        note: 'IT 개발자 이상 · /kanban',                             desc: '종료됨 컬럼은 기본으로 최근 10건만 표시합니다. "▾ +N건 더 보기" 버튼으로 전체를 펼치고 "▴ 최근 10건만 보기" 버튼으로 다시 접을 수 있습니다. 컬럼 헤더 우측 "◀" 버튼을 클릭하면 컬럼 전체가 좁은 세로 띠로 축소되어 다른 컬럼 작업에 방해받지 않습니다. "▶" 버튼을 클릭하면 다시 펼칩니다. 업무 처리량이 많고 오래된 환경에서도 칸반 보드를 쾌적하게 사용할 수 있습니다.', isNew: true },
  { emoji: '🚫', title: '칸반 드래그 전환 규칙 강제',         note: 'IT 개발자 이상 · /kanban',                             desc: '카드 드래그 시작 순간, 현재 상태에서 이동이 허용되지 않는 컬럼이 자동으로 흐리게(opacity 40%) 비활성화되고 🚫 아이콘이 표시됩니다. 허용된 컬럼만 파란 하이라이트로 강조됩니다. 백엔드 VALID_TRANSITIONS와 동일한 규칙을 프론트에서 사전 적용하여 API 실패 후 카드가 원위치로 돌아오는 불필요한 UX를 방지합니다.', isNew: true },
  { emoji: '🗓️', title: '칸반 기간 필터',                     note: 'IT 개발자 이상 · /kanban',                             desc: '칸반 보드 상단에 기간 필터 드롭다운(전체 기간 · 오늘 · 이번 주 · 이번 달)이 추가되었습니다. 선택한 기간에 해당하는 티켓만 필터링하여 표시하며, 우선순위·담당자 필터와 조합하여 사용할 수 있습니다. 현재 기간 조건에서 표시 중인 전체 티켓 수가 헤더에 실시간으로 업데이트됩니다.', isNew: true },
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
  { emoji: '📚', title: '지식베이스 (KB)',                      note: 'PL 이상 작성 · 전체 열람',                       desc: 'PostgreSQL FTS 전문 검색·태그 필터·카테고리 분류를 지원하는 지식베이스입니다. Markdown 형식으로 작성합니다. 작성·편집은 PL(pl) 이상, 삭제는 관리자(admin)만 가능합니다.' },
  { emoji: '💡', title: 'KB 자동 추천',                        note: '티켓 등록 시 전체 사용자',                              desc: '티켓 제목을 6자 이상 입력하면 300ms 디바운스로 관련 KB 아티클을 자동 추천합니다. /kb/suggest API와 PostgreSQL FTS를 기반으로 동작합니다.', isNew: true },
  { emoji: '📊', title: '리포트 & 에이전트 성과',              note: 'IT 관리자 이상',                                        desc: '전체 현황(신규·종료·SLA 위반·만족도)과 담당자별 성과(처리 건수·SLA 달성률·평균 평점)를 확인합니다.' },
  { emoji: '📥', title: '티켓 CSV · Excel 내보내기',             note: 'IT 에이전트 이상 · /tickets/export/csv · /tickets/export/xlsx', desc: '현재 필터 조건이 그대로 적용된 티켓 목록을 CSV 또는 Excel(xlsx)로 다운로드합니다. CSV는 UTF-8 BOM으로 엑셀에서 즉시 열 수 있으며, XLSX는 헤더 강조(파란 배경·굵은 글씨)·열 너비 자동 조정이 적용된 서식 있는 파일로 저장됩니다. CSV 수식 인젝션(Formula Injection) 방어가 양쪽 포맷에 모두 적용됩니다.', isNew: true },
  { emoji: '📊', title: '리포트 CSV · Excel 내보내기',           note: 'IT 에이전트 이상 · /reports (리포트 내보내기 버튼)',    desc: '리포트 페이지에서 현재 기간 조건의 에이전트 성과 리포트를 CSV 또는 Excel(xlsx)로 내보낼 수 있습니다. 내보내기 버튼 클릭 시 포맷 선택(CSV/Excel) 드롭다운이 표시되며, GET /reports/export?format=csv&period=… API를 호출합니다. 담당자·처리 건수·SLA 달성률·평균 평점 컬럼이 포함되며, XLSX 포맷은 헤더 강조와 열 너비 자동 조정이 적용됩니다.', isNew: true },
  { emoji: '🧬', title: '티켓 복제(Clone)',                    note: 'IT 개발자 이상',                                        desc: 'POST /tickets/{iid}/clone 으로 티켓의 제목·카테고리·우선순위·본문을 복사하여 새 티켓을 생성합니다. 원본 티켓과 related 링크가 자동 연결되고, 복제 알림 댓글이 자동 추가됩니다.', isNew: true },
  { emoji: '🔐', title: 'GitLab Confidential Issue',           note: '티켓 등록 시 전체 사용자',                              desc: '티켓 등록 시 "기밀 티켓" 체크박스를 선택하면 GitLab에 confidential=true로 이슈가 생성됩니다. IT 에이전트 이상 역할만 해당 티켓을 조회할 수 있습니다.', isNew: true },
  { emoji: '🤖', title: '자동 담당자 배정',                    note: '시스템관리자 설정',                                    desc: '카테고리·우선순위·키워드 조건 규칙을 설정하면 신규 티켓 접수 시 담당자가 자동 배정됩니다.' },
  { emoji: '🚨', title: 'SLA 에스컬레이션 자동 정책',          note: 'IT 시스템관리자 설정 · /admin/escalation-policies',   desc: 'SLA 위반/임박 시 자동으로 실행할 정책을 설정합니다. 알림 발송·담당자 변경·우선순위 자동 상향 3가지 액션과 우선순위·트리거·지연 시간 조건을 조합합니다. SLA 체커 스레드(5분 주기)에서 실행되며 중복 실행을 방지합니다.' },
  { emoji: '⏰', title: 'SLA 정책 관리 (DB화)',                 note: '시스템관리자',                                         desc: '우선순위별 응답·해결 목표 시간을 UI에서 직접 수정합니다. 변경 즉시 신규 티켓부터 적용됩니다.' },
  { emoji: '🕘', title: '업무 시간 기반 SLA 계산',              note: '시스템관리자 설정 · /admin/business-hours',             desc: '요일별 업무 시작·종료 시각(기본 09:00~18:00)과 공휴일을 설정하면 SLA 경과 시간이 실제 업무 시간만 계산됩니다. 비업무 시간(야간·주말·공휴일)에 접수된 티켓은 다음 업무 시간 시작 시점부터 SLA 타이머가 카운트됩니다. 연도별 공휴일 자동 등록과 개별 날짜 추가·삭제를 지원합니다.', isNew: true },
  { emoji: '📧', title: '이메일 템플릿 관리',                   note: 'IT 시스템관리자 · /admin/email-templates',            desc: '이벤트별 이메일 알림 내용을 Jinja2 템플릿 문법으로 커스터마이즈합니다. 미리보기로 샘플 데이터 렌더링을 확인한 후 저장합니다. DB 템플릿 우선 적용, 없으면 하드코딩 폴백.' },
  { emoji: '🏷️', title: '서비스 유형 동적 관리',               note: '시스템관리자 · /admin/service-types',                  desc: '카테고리(서비스 유형)를 DB에서 관리합니다. 관리자 UI에서 이모지·색상·이름·하위 선택지를 추가·수정·삭제할 수 있으며 즉시 티켓 등록 폼에 반영됩니다. 추가·수정 시 GitLab에 cat::{id} 라벨이 자동 동기화됩니다. 사용 중인 티켓이 있는 서비스 유형은 삭제가 차단되며, 뱃지로 사용 현황이 표시됩니다.' },
  { emoji: '🗒️', title: '감사 로그',                            note: 'IT 관리자 이상',                                        desc: '티켓 생성·수정·삭제·역할 변경·일괄 작업 등 주요 이벤트의 수행자 이름·역할(배지)·IP 주소·타임스탬프를 추적합니다. 기간·액션·행위자 검색 필터와 CSV 다운로드, 페이지네이션을 지원합니다.' },
  { emoji: '📣', title: 'Telegram·이메일·Slack 알림',            note: '시스템관리자 설정',                                    desc: '티켓 생성·상태 변경·SLA 위반 시 Telegram 채널·이메일·Slack Incoming Webhook으로 자동 알림이 발송됩니다. SLA 해결 기한 1시간 전에도 담당자에게 사전 경고 알림이 전송됩니다. 알림 전송은 Celery 비동기 태스크로 처리되어 API 응답 지연 없이 즉시 반환됩니다.', isNew: true },
  { emoji: '🔗', title: '아웃바운드 웹훅',                      note: 'IT 시스템관리자 · /admin/outbound-webhooks',          desc: 'Slack Incoming Webhook, Teams Power Automate 등 외부 서비스와 즉시 연동합니다. HMAC-SHA256 서명, 3회 지수 백오프 재시도를 지원합니다.', isNew: true },
  { emoji: '🔑', title: 'API 키 인증',                          note: 'Admin 발급 · /admin/api-keys',                         desc: 'Authorization: Bearer itsm_live_xxxx 헤더로 외부 시스템에서 ITSM API를 호출할 수 있습니다. 스코프: tickets:read, tickets:write, kb:read, kb:write, webhooks:write. API 키는 SHA-256 해시로 저장(평문 미보관)됩니다.', isNew: true },
  { emoji: '🌐', title: '고객 셀프서비스 포털',                 note: '비로그인 공개 · /portal',                               desc: 'GitLab 계정 없이도 이름·이메일·제목·내용만으로 IT 지원을 요청할 수 있습니다. 접수 후 발급된 토큰 링크(/portal/track/{token})로 티켓 진행 상황을 실시간 확인합니다. 포털 제출은 분당 5건 Rate Limit이 적용됩니다.' },
  { emoji: '⏸️', title: 'SLA 일시정지/재개',                   note: '자동 (waiting 상태 연동)',                              desc: '티켓 상태가 "대기중(waiting)"으로 전환되면 SLA 타이머가 자동으로 일시정지됩니다. 상태가 변경되면 정지된 시간(total_paused_seconds)을 제외하고 SLA 경과 시간을 계산합니다.' },
  { emoji: '✉️', title: 'IMAP 이메일 → 티켓 자동 생성',        note: '시스템관리자 설정 (IMAP_ENABLED=true)',                 desc: '지정한 이메일 수신함을 60초 간격으로 폴링하여 새 메일을 티켓으로 자동 변환합니다. Message-ID를 Redis에 30일 TTL로 저장하여 중복 생성을 방지하고, 접수 확인 이메일을 발신자에게 자동 회신합니다.' },
  { emoji: '🔀', title: 'MR 머지 → 티켓 자동 해결',            note: '자동 (GitLab 웹훅 연동)',                               desc: 'GitLab Merge Request 설명에 "Closes #N", "Fixes #N", "#N" 패턴을 포함하면, MR 머지 시 해당 티켓이 자동으로 "resolved" 상태로 전환되고 자동 코멘트가 추가됩니다.' },
  { emoji: '📝', title: '리치 텍스트 에디터 (TipTap)',          note: 'IT 개발자 이상 (티켓·KB 작성)',                         desc: 'TipTap 기반 WYSIWYG 에디터로 Bold·Italic·코드블록·순서 없는 목록·표·이미지 삽입을 지원합니다. 이미지는 파일 선택 → 서버 업로드 → 에디터 자동 삽입 방식으로 처리됩니다. 댓글 에디터에서 @ 입력 시 프로젝트 멤버 목록이 tippy.js 팝업으로 표시되며, 선택된 멘션은 파란색 칩(mention) 형태로 삽입됩니다.' },
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
  { emoji: '📊', title: '비즈니스 KPI 모니터링',                note: '시스템관리자 · Grafana :3001',                         desc: 'Prometheus 커스텀 메트릭(27종)을 5분 주기로 DB에서 집계합니다. Grafana "ITSM 메뉴별 운영 현황" 대시보드(4번째)에서 티켓·KB·칸반·리포트·관리 메뉴별 KPI(SLA 위반 수·KB 게시율·알림 확인율·사용자 역할 분포 등)를 시각화합니다.', isNew: true },
  { emoji: '🔑', title: 'Sudo 모드 (관리자 재인증)',             note: 'Admin 전용',                                            desc: '민감한 관리 작업 수행 전 GitLab 비밀번호로 재인증하는 Sudo 토큰 시스템입니다. 15분 유효하며, 사용자 역할 변경·세션 강제 종료 등 고위험 작업에 적용됩니다.', isNew: true },
  { emoji: '🏷️', title: 'GitLab 라벨 동기화 관리',              note: 'Admin 전용 · /admin/labels',                            desc: 'status::/prio::/cat:: 라벨이 GitLab 프로젝트·그룹 양쪽에 존재하는지 현황 표시(✅/❌)와 수동 동기화 기능을 제공합니다. 서비스 유형 추가·수정 시 cat::{id} 라벨이 자동 동기화됩니다. 라벨은 생성·색상 업데이트만 수행하며 절대 삭제하지 않습니다(삭제 시 GitLab이 이슈 라벨을 자동 제거).', isNew: true },
  { emoji: '📋', title: '구독 중인 티켓 목록',                   note: '전체 · /notifications',                                 desc: '헤더 알림 벨 → "구독 중인 티켓" 또는 /notifications 페이지의 첫 번째 탭에서 내가 구독 중인 모든 티켓 목록을 확인하고 구독 취소할 수 있습니다. 각 티켓의 제목·상태·우선순위·담당자·구독일이 표시되며 구독 취소는 🔕 버튼으로 즉시 적용됩니다.', isNew: true },
  { emoji: '🛡️', title: '서비스 유형 삭제 보호',                 note: '시스템관리자',                                         desc: '서비스 유형(카테고리)을 삭제하려 할 때 해당 카테고리를 사용하는 티켓이 있으면 삭제가 자동 차단됩니다. 목록에서 사용 중인 티켓 수가 뱃지(🎫 N건 사용 중)로 표시되며 삭제 버튼이 비활성화됩니다. 티켓이 없는 경우에만 삭제 가능하며, 운영 중에는 "비활성화"를 사용하는 것이 권장됩니다.', isNew: true },
  { emoji: '🏁', title: 'GitLab 마일스톤 연동',               note: 'IT 개발자 이상 · 티켓 등록/수정',                        desc: '티켓 등록 시 GitLab 마일스톤을 선택하여 연결합니다. 마일스톤이 활성화된 프로젝트에서만 선택 드롭다운이 표시됩니다. 티켓 상세 사이드바에서 마일스톤 변경(연결·해제) 및 현재 마일스톤 이름을 확인할 수 있습니다. GET /projects/{project_id}/milestones API로 활성 마일스톤 목록을 조회하며, milestone_id=0 전송 시 마일스톤이 해제됩니다.', isNew: true },
  { emoji: '✅', title: '티켓 승인 워크플로우',                note: 'IT 에이전트 이상 · 티켓 상세',                           desc: '접수된(open) 티켓에 IT 에이전트가 "✅ 승인" 버튼을 클릭하면 "승인완료(approved)" 상태로 전환됩니다. agent 이상 역할은 자신이 요청한 승인도 직접 처리(자기 승인)할 수 있습니다. 승인/거절 실패 시 서버에서 반환하는 오류 메시지가 화면에 표시됩니다. 요청자 본인이 거절할 경우 버튼이 "취소"로 표시됩니다.', isNew: true },
  { emoji: '📝', title: '커스텀 필드 관리',                    note: 'Admin 설정 · /admin/custom-fields',                     desc: '관리자가 티켓에 표시할 추가 입력 필드를 자유롭게 정의합니다. 지원 유형: 텍스트(text)·숫자(number)·선택 목록(select, 옵션 직접 추가)·체크박스(checkbox). 필드 키(영소문자·숫자·_만 허용, 생성 후 변경 불가)·표시 이름·필수 여부·정렬 순서를 설정합니다. 활성/비활성 토글 및 삭제(연결된 값 cascade 삭제) 기능을 지원합니다. 에이전트 이상은 티켓 상세 우측 사이드바 "추가 정보" 섹션에서 필드 값을 입력·저장할 수 있습니다.', isNew: true },
  { emoji: '🔗', title: '티켓 병합 (Merge)',                   note: 'IT 에이전트 이상 · 티켓 상세 사이드바',                  desc: '중복 티켓을 다른 티켓으로 병합합니다. 티켓 상세 우측 하단 "티켓 병합" 섹션에서 대상 티켓 번호를 입력하고 병합 버튼을 클릭합니다. 병합 시: ① 소스 티켓 댓글이 대상 티켓에 복사됩니다 ② 소스 티켓에 병합 안내 코멘트가 자동 추가된 후 closed 처리됩니다 ③ 대상 티켓에 병합 완료 코멘트가 추가됩니다. POST /tickets/{iid}/merge?target_iid={n} API를 사용합니다.', isNew: true },
  { emoji: '🏷️', title: '@멘션 (댓글)',                         note: 'IT 개발자 이상 · 댓글 에디터',                            desc: '댓글 입력 시 @ 기호를 입력하면 현재 프로젝트 멤버 목록이 팝업으로 표시됩니다. 화살표 키로 탐색하고 Enter 또는 클릭으로 선택하면 @username 형태로 삽입됩니다. @멘션된 사용자에게는 인앱 알림이 자동 발송됩니다. TipTap Mention Extension 및 tippy.js 기반 팝업으로 동작합니다.', isNew: true },
  { emoji: '🔒', title: 'PII 자동 마스킹',                      note: '시스템 자동 (fail-soft)',                                desc: '티켓 제목·본문·댓글에 개인식별정보(PII) 포함 여부를 자동으로 탐지합니다. 탐지 대상: 주민등록번호(000000-1000000), 국내 휴대폰(010-XXXX-XXXX), 유선전화(02-XXXX-XXXX), 국제전화(+82-...), 여권번호(A12345678), 신용카드번호(1234-5678-9012-3456). 탐지 시 경고 로그를 기록하며, 일반 사용자(user 역할)의 응답에서는 PII 항목이 *** 형태로 마스킹됩니다. 에이전트·관리자는 원본 내용을 볼 수 있습니다. 차단하지 않는 fail-soft 방식으로 동작합니다.', isNew: true },
  { emoji: '📈', title: 'DORA 4대 지표',                        note: 'IT 에이전트 이상 · /reports (DORA 지표 탭)',              desc: '리포트 페이지 "DORA 지표" 탭에서 DORA Research 2023 기준 4대 DevOps 핵심 지표를 확인합니다. ① 배포 빈도(Deployment Frequency): 주간 완료(closed) 티켓 수 ② 리드타임(Lead Time): SLA 기록 기준 접수→완료 평균 시간(시간) ③ 변경 실패율(Change Failure Rate): 완료 후 재오픈된 티켓 비율(%) ④ 평균 복구 시간(MTTR): 재오픈→재완료까지 평균 시간(시간). 각 지표별로 Elite/High/Medium/Low 등급이 자동 산정됩니다. 조회 기간(7~365일)을 선택할 수 있습니다.', isNew: true },
  { emoji: '🔄', title: 'GitLab → ITSM 양방향 동기화',           note: '자동 (GitLab Issue Update Hook)',                        desc: 'GitLab에서 직접 이슈를 수정(제목·설명·담당자·라벨 변경)하면 ITSM 감사 로그와 인앱 알림이 자동으로 기록됩니다. 웹훅 루프 방지: GITLAB_BOT_USERNAME 환경변수에 ITSM 서비스 계정 username을 설정하면, 해당 계정이 수행한 변경은 루프 방지를 위해 알림을 생략합니다. 댓글(Note) 웹훅 수신 시 신청자뿐만 아니라 담당자(assignees) 전원에게 인앱 알림이 발송됩니다.', isNew: true },
  { emoji: '🏷️', title: '티켓 유형 분류 (Ticket Type)',           note: 'IT 개발자 이상 · 티켓 상세 사이드바',                    desc: '티켓을 4가지 유형으로 분류하여 ITIL 기반 운영을 지원합니다. ① 인시던트(incident): 서비스 장애·오류 신고. ② 서비스 요청(service_request): 계정 생성·소프트웨어 설치 등 정형화된 요청. ③ 변경 요청(change): 시스템 구성 변경·배포 요청. ④ 문제(problem): 반복 인시던트의 근본 원인 분석 및 해결. 티켓 상세 우측 사이드바에서 컬러 배지로 유형을 표시하며, "변경" 버튼 클릭 시 인라인 선택 피커가 열립니다. 마지막 변경자와 변경 시각도 함께 표시됩니다. "문제" 유형 선택 시 연결된 인시던트 관리 패널이 활성화됩니다.', isNew: true },
  { emoji: '📦', title: '서비스 카탈로그 (Service Catalog)',       note: 'Admin 설정 · /admin/service-catalog · 포털 통합',        desc: '관리자가 IT 서비스 항목을 카탈로그로 정의하면 고객 포털(/portal)에 카드 형태로 표시됩니다. 카탈로그 항목에는 이름·아이콘·설명·카테고리·추가 입력 필드(text/textarea/select/date)를 자유롭게 설정합니다. 사용자가 포털에서 카탈로그 항목을 선택하면 제목이 자동 입력되고, 해당 항목에 정의된 추가 필드가 표시되어 서비스별 필수 정보를 수집할 수 있습니다. 관리자 화면(/admin/service-catalog)에서 항목 생성·수정·활성화·삭제 및 필드 스키마 편집이 가능합니다.', isNew: true },
  { emoji: '🔗', title: '문제 관리 (Problem Management)',          note: 'IT 개발자 이상 · 티켓 유형 "문제" 선택 시',              desc: '티켓 유형을 "문제(problem)"로 설정하면 사이드바에 문제 관리 패널이 나타납니다. 인시던트 티켓 번호를 입력하여 "problem_of" 링크로 연결하면 해당 문제와 관련된 모든 인시던트를 한 곳에서 추적할 수 있습니다. 연결된 인시던트는 목록으로 표시되며 개별 제거도 가능합니다. 기존 티켓 링크(TicketLink) 인프라를 재사용하여 link_type=problem_of 방식으로 저장됩니다.', isNew: true },
  { emoji: '🎛️', title: '대시보드 위젯 커스터마이징',              note: '전체 · 홈 화면',                                         desc: '홈 화면 상단의 위젯 바에서 ⚙️ 버튼을 클릭하면 위젯 표시 여부를 개인별로 설정할 수 있습니다. 위젯 종류: ① 상태 현황 탭(stats_bar — 전체 티켓 현황 탭), ② 내 담당 티켓(my_tickets — 배정된 티켓 수 및 목록), ③ SLA 현황(sla_status — 위반·임박 건수), ④ 최근 활동(recent_activity — 최신 티켓 목록). 설정은 서버(/dashboard/config)에 저장되어 다른 기기에서도 동일하게 적용됩니다.', isNew: true },
  { emoji: '⚙️', title: '자동화 규칙 엔진 (Automation Rules)',     note: 'Admin 설정 · /admin/automation-rules',                   desc: '티켓 이벤트 발생 시 조건에 따라 자동으로 액션을 실행하는 규칙을 정의합니다. 트리거 이벤트(ticket.created / ticket.updated / ticket.closed 등)·조건(필드·연산자·값 조합)·액션(상태 변경·우선순위 설정·알림 발송 등)을 자유롭게 조합합니다. 규칙은 우선순위(order) 순서대로 평가되며 is_active 토글로 개별 활성/비활성화가 가능합니다. 조건과 액션은 JSONB 배열로 저장되어 유연한 확장이 가능합니다.', isNew: true },
  { emoji: '🗓️', title: 'SLA 위반 히트맵',                       note: 'IT 에이전트 이상 · /reports (전체 현황 탭)',             desc: '리포트 페이지 전체 현황 탭에서 최근 12주간의 SLA 위반 건수를 GitHub 잔디 스타일 히트맵으로 시각화합니다. 요일(월~일) × 주 단위 격자로 표시되며 위반 건수에 따라 5단계 색상 강도로 표현됩니다. 셀 위에 마우스를 올리면 날짜·위반 건수·전체 건수가 툴팁으로 표시됩니다. 일별 스냅샷 데이터 기반으로 동작합니다.', isNew: true },
  { emoji: '📖', title: 'KB 문서 버전 이력',                     note: 'IT 개발자 이상 · KB 수정 시 자동 저장',                 desc: 'KB 아티클을 수정할 때마다 이전 버전이 자동으로 저장됩니다(최대 10개, 이후 오래된 순 자동 삭제). KB 상세 페이지 우측 상단 "버전 이력" 버튼을 클릭하면 사이드바가 열려 버전 목록(버전 번호·수정 시각·수정자)과 선택한 버전의 제목·본문 미리보기를 바로 확인할 수 있습니다. API로도 조회 가능: GET /kb/articles/{id}/revisions (목록), GET /kb/articles/{id}/revisions/{rev_id} (상세).', isNew: true },
  { emoji: '📤', title: 'CSV 일괄 티켓 생성',                    note: 'IT PL 이상 · POST /tickets/import/csv',                 desc: 'CSV 파일로 티켓을 일괄 생성합니다. 필수 컬럼: title, description, category, priority, employee_name, employee_email. 선택 컬럼: department, location. UTF-8 BOM 및 CP949 인코딩을 자동 감지하며 최대 500행, dry_run=true 파라미터로 파싱 결과만 확인 후 실제 생성 여부를 결정할 수 있습니다.', isNew: true },
  { emoji: '📬', title: '승인 요청 이메일 알림',                  note: '자동 · 승인 요청/결정 시',                              desc: '승인 요청 생성 시 지정된 승인자에게, 승인·거절 결정 시 요청자에게 이메일이 자동 발송됩니다. NOTIFICATION_ENABLED=true 환경변수가 설정된 경우 동작하며, 이메일 발송 실패 시에도 인앱 알림은 정상 전달됩니다(fail-soft).', isNew: true },
  { emoji: '🤖', title: '자동화 규칙 실행 이력',                  note: 'Admin · /admin/automation-rules → 이력 버튼',           desc: '자동화 규칙이 평가될 때마다 실행 이력이 자동으로 기록됩니다. 규칙 카드의 "이력" 버튼을 클릭하면 최근 50건의 실행 이력(티켓 번호·트리거 이벤트·매칭 여부·실행된 액션 목록·시각)을 모달로 확인할 수 있습니다. GET /automation-rules/{id}/logs, GET /automation-rules/logs/recent API로도 조회 가능합니다.', isNew: true },
  { emoji: '📥', title: '이메일 수신 모니터링',                   note: 'Admin · /admin/email-ingest',                           desc: 'IMAP 이메일 수신 설정 상태(서버·계정·스케줄)를 확인하고 Celery Beat가 처리하는 이메일 인제스트를 수동으로 즉시 실행할 수 있습니다. 비활성화 시 필요한 환경변수 안내를 함께 표시합니다.', isNew: true },
  { emoji: '🌑', title: '다크모드 FOUC 수정',                   note: '전체 · 페이지 로드',                                     desc: '페이지 최초 로드 시 라이트 모드가 잠깐 깜빡이다가 다크 모드로 전환되는 FOUC(Flash of Unstyled Content) 현상을 수정했습니다. HTML <head>에 동기 인라인 스크립트를 삽입하여 React hydration 이전에 localStorage와 시스템 설정을 읽어 즉시 dark 클래스를 적용합니다.', isNew: true },
  { emoji: '📐', title: '처리완료 모달 높이 제한',              note: '전체 · 처리완료·종료 상태 전환 시',                        desc: '처리완료(resolved)/종료(closed) 전환 시 표시되는 해결 노트 모달이 화면 높이를 초과하던 문제를 수정했습니다. max-h-[90vh] + overflow-y-auto 적용으로 내용이 많아도 스크롤 처리되며, 헤더·푸터는 항상 화면에 고정됩니다. 다크모드 스타일도 함께 적용되었습니다.', isNew: true },
  { emoji: '🔗', title: '마크다운 첨부파일 인라인 렌더링 개선', note: '전체 · KB · 티켓 댓글',                                   desc: 'KB 아티클과 티켓 댓글에서 첨부파일 링크가 마크다운 원문(`[📎 파일명.pdf](URL)`)으로 노출되던 문제를 수정했습니다. MarkdownRenderer가 /uploads/proxy 및 /-/project/ 경로를 감지하여 FilePreview 컴포넌트로 자동 렌더링합니다. 이미지는 썸네일+라이트박스, PDF는 인라인 미리보기, 기타 파일은 다운로드 버튼으로 표시됩니다.', isNew: true },
]

/* ─── 보안 기능 데이터 ────────────────────────────────────────────────── */

const SECURITY_FEATURES: { emoji: string; title: string; desc: string; isNew?: boolean }[] = [
  { emoji: '🛡️', title: '감사 로그 Immutable (변경 불가)',      desc: 'PostgreSQL 트리거(audit_logs_no_update, audit_logs_no_delete)로 audit_logs 테이블에 대한 UPDATE/DELETE를 영구 차단합니다. 한 번 기록된 감사 이벤트는 절대 수정되거나 삭제될 수 없어 규정 준수(Compliance)를 보장합니다.', isNew: true },
  { emoji: '🖼️', title: '이미지 EXIF 메타데이터 자동 제거',     desc: '업로드된 이미지(JPEG/PNG/WebP)에서 GPS 위치·기기 정보·작성자 등 개인 식별 EXIF 메타데이터를 Pillow 라이브러리로 자동 제거합니다. PDF 등 지원 외 형식은 그대로 통과합니다.', isNew: true },
  { emoji: '🔍', title: '비밀 스캐닝 (Secret Detection)',        desc: '티켓·댓글 제출 시 AWS Access Key, GitLab PAT, OpenAI API Key, RSA Private Key, DB 비밀번호 등 9개 패턴을 정규식으로 자동 탐지합니다. 탐지 시 경고 로그 기록과 마스킹 처리가 되며, 차단하지 않는 fail-soft 방식으로 동작합니다.', isNew: true },
  { emoji: '🪪', title: 'PII 자동 탐지 및 마스킹',               desc: '티켓 본문·댓글에 개인식별정보(PII)가 포함되면 자동 탐지 후 경고 로그를 기록합니다. 탐지 패턴: 주민등록번호(\\d{6}-[1-4]\\d{6}), 휴대폰(01X-XXXX-XXXX), 유선전화(0X-XXXX-XXXX), 국제전화(+82-...), 여권번호(A\\d{8}), 신용카드(\\d{4}-\\d{4}-\\d{4}-\\d{4}). 일반 사용자(user 역할) 응답에서는 PII가 *** 형태로 자동 치환되며, 에이전트·관리자는 원본 내용에 접근할 수 있습니다. 비밀 스캐닝(secret_scanner)과 병렬로 실행되며 모두 fail-soft 설계입니다.', isNew: true },
  { emoji: '🔐', title: '세션 최대 동시 접속 제한',              desc: 'MAX_ACTIVE_SESSIONS=5 환경변수로 계정당 동시 활성 세션 수를 제한합니다. 한도 초과 시 가장 오래된 세션이 자동으로 폐기(무효화)됩니다. Admin UI에서 특정 사용자의 세션 목록 조회 및 강제 종료가 가능합니다.', isNew: true },
  { emoji: '🦠', title: 'ClamAV 바이러스 스캔',                  desc: '파일 업로드 시 ClamAV 엔진으로 바이러스/악성코드를 실시간 스캔합니다. ARM64 환경에서는 linux/amd64 에뮬레이션으로 동작합니다. CLAMAV_ENABLED=false 환경변수로 비활성화 가능합니다.', isNew: true },
  { emoji: '🔑', title: 'JWT Refresh Token + Token Rotation',    desc: 'Access Token(2시간) + Refresh Token(7일) 이중 인증 구조입니다. Refresh Token 사용 시 새 토큰으로 교체(Rotation)되어 탈취된 토큰 재사용을 방지합니다. 기본 유효기간은 7일로 단축되어 세션 탈취 위험을 줄입니다.' },
  { emoji: '🔒', title: 'CSP / HSTS 보안 헤더',                  desc: 'Nginx에서 Content-Security-Policy, Strict-Transport-Security(max-age=31536000), X-Frame-Options: DENY, X-Content-Type-Options: nosniff 헤더를 자동 설정합니다.' },
  { emoji: '⚡', title: 'Rate Limiting (엔드포인트별)',           desc: 'slowapi로 엔드포인트별 Rate Limit을 적용합니다. 포털 제출 5건/분, 티켓 생성 10건/분 등 서비스별로 세분화됩니다. 프로덕션 환경에서 Rate Limiting이 비활성화되면 시작 로그에 CRITICAL 경고가 기록됩니다.' },
  { emoji: '🦊', title: 'GitLab OAuth SSO',                       desc: '모든 인증은 GitLab OAuth 2.0 Authorization Code Flow를 통합니다. 별도 비밀번호 관리 없이 GitLab 계정으로 로그인합니다.' },
  { emoji: '📏', title: 'API 입력 길이 검증 (Pydantic)',          desc: '모든 API 입력값에 최대 길이 제한이 적용됩니다. 필터 이름 200자, 빠른 답변 내용 5,000자, 개발 전달 메모 2,000자 등 필드별 Pydantic Field(max_length=N) 검증으로 과도하게 큰 입력이 API 레벨에서 422로 즉시 거부됩니다.', isNew: true },
  { emoji: '🔇', title: 'ClamAV 내부 오류 정보 차단',             desc: '파일에서 악성코드가 탐지된 경우 ClamAV 엔진의 내부 응답(바이러스 시그니처 명 등 상세 정보)이 API 에러 메시지에 포함되지 않습니다. 공격자가 스캐너 버전·패턴 정보를 수집하는 것을 방지합니다.', isNew: true },
  { emoji: '🌐', title: 'IP 허용목록 (IP Allowlist)',              desc: '관리자가 허용된 IP/CIDR 대역만 API 접근을 허용하도록 설정합니다. 설정이 없으면 전체 허용. /ip-allowlist/my-ip 엔드포인트는 인증된 사용자만 현재 접속 IP를 확인할 수 있습니다.', isNew: true },
  { emoji: '🔐', title: '승인 워크플로우 보안 강화',               desc: 'project_id 화이트리스트 검증으로 유효한 GitLab 프로젝트만 승인 요청 생성이 가능합니다. IP 허용목록 미들웨어에 JWT 블랙리스트 검증을 추가하여 로그아웃된 토큰은 IP 검사에서도 차단됩니다.', isNew: true },
  { emoji: '🛰️', title: 'X-Forwarded-For 신뢰 프록시 검증',       desc: 'Sudo 모드 토큰 발급·검증 시 X-Forwarded-For 헤더를 무조건 신뢰하지 않습니다. TRUSTED_PROXIES 환경변수에 등록된 프록시 또는 사설 IP 대역에서 온 요청만 XFF를 신뢰하며, 그 외는 실제 연결 IP를 사용합니다. IP 스푸핑을 통한 Sudo 권한 우회를 방지합니다.', isNew: true },
  { emoji: '🧹', title: 'DOMPurify HTML 새니타이저',               desc: '티켓 상세 화면의 HTML 렌더링에 isomorphic-dompurify를 적용합니다. 커스텀 정규식 체인 대신 업계 표준 DOMPurify로 <script>, 이벤트 핸들러(onclick 등), <details ontoggle> 등 모든 XSS 벡터를 차단합니다. ALLOWED_TAGS/ALLOWED_ATTR 화이트리스트 방식으로 허용된 태그만 통과합니다.', isNew: true },
  { emoji: '🔏', title: 'SECRET_KEY 약한 기본값 차단',             desc: 'JWT 서명 키(SECRET_KEY)에 "change_me_to_random_32char_string" 등 공개 레포에 노출된 기본값이 설정된 채로 서버가 시작되지 않습니다. 최소 32자 이상의 강력한 랜덤 키를 요구하며, 미달 시 서버 시작 실패로 설정 오류를 즉시 감지할 수 있습니다.', isNew: true },
  { emoji: '🚨', title: '파괴적 관리 작업 Sudo 재인증',            desc: '서비스 유형 삭제, 에스컬레이션 정책 삭제, 아웃바운드 웹훅 삭제, API 키 취소 등 되돌리기 어려운 관리 작업에 verify_sudo_token을 추가 적용합니다. 관리자 계정이 탈취되더라도 Sudo 재인증 없이는 파괴적 작업을 수행할 수 없습니다.', isNew: true },
  { emoji: '📊', title: 'CSV 수식 인젝션(Formula Injection) 방어', desc: "티켓 목록 CSV 다운로드 시 =, +, -, @ 등으로 시작하는 필드 값 앞에 작은따옴표(')를 자동 삽입합니다. Excel·Google Sheets에서 파일을 열었을 때 셀 수식이 실행되는 CSV Injection 공격을 방어합니다.", isNew: true },
  { emoji: '📝', title: '감사 로그 필터 Allowlist',                desc: '감사 로그 검색 API의 resource_type, action 필터 값을 서버 측 허용 목록(allowlist)으로 검증합니다. 임의 문자열을 필터로 전달해 시스템 내부 정보를 탐색하는 정보 수집(Information Probing) 공격을 방지합니다.', isNew: true },
  { emoji: '✉️', title: '이메일 본문 XSS 이스케이프',              desc: '고객 포털 접수 확인 이메일 생성 시 사용자 입력값(이름, 트래킹 URL)을 html.escape()로 이스케이프합니다. 이름 필드에 HTML 태그나 스크립트를 삽입해 이메일 클라이언트에서 실행하는 XSS 공격을 방어합니다.', isNew: true },
  { emoji: '🪝', title: 'Webhook 알림 제어문자 제거',              desc: 'GitLab 웹훅 페이로드에서 수신한 작성자 이름, 댓글 미리보기 등 외부 문자열의 줄바꿈(CR/LF)과 제어문자를 제거합니다. 멀티라인 문자열을 이용한 로그 인젝션과 인앱 알림 body 오염을 방지합니다.', isNew: true },
  { emoji: '🔎', title: 'KB 검색 LIKE 메타문자 이스케이프',        desc: '지식베이스 전문 검색의 LIKE 폴백 쿼리에서 %, _, \\ 메타문자를 이스케이프 처리합니다. 검색어에 와일드카드를 포함해 DB 부하를 유발하거나 의도치 않은 데이터를 반환하는 LIKE Wildcard Injection을 방어합니다.', isNew: true },
  { emoji: '🔗', title: '인앱 알림 링크 내부 경로 검증',           desc: '인앱 알림의 link 필드는 /로 시작하는 내부 상대 경로만 허용합니다. ://, //로 시작하는 외부 URL 또는 CRLF를 포함한 값은 자동 거부됩니다. 알림 링크를 통한 Open Redirect 공격을 방어합니다.', isNew: true },
  { emoji: '📡', title: 'Prometheus / Grafana localhost 전용',     desc: 'Prometheus(:9090)와 Grafana(:3001)는 127.0.0.1에만 바인딩되어 외부에서 직접 접근이 불가능합니다. Grafana 관리자 비밀번호(GRAFANA_PASSWORD)는 .env 미설정 시 docker compose up 자체가 실패하여 기본 비밀번호 노출을 원천 차단합니다.', isNew: true },
  { emoji: '🌍', title: 'CORS 와일드카드 프로덕션 차단',            desc: 'CORS_ORIGINS에 *(전체 허용)를 설정한 채로 ENVIRONMENT=production으로 시작하면 서버 시작 실패로 처리됩니다. 개발 환경에서는 경고만 출력하고, 프로덕션에서는 명시적 출처 설정을 강제합니다.', isNew: true },
  { emoji: '🔬', title: '의존성 취약점 자동 스캔 (pip-audit / npm audit)', desc: 'GitHub Actions CI에서 pip-audit(Python 패키지)과 npm audit(Node.js 패키지)를 자동 실행합니다. push/PR 시마다 known CVE를 탐지하고, Trivy로 Docker 이미지 취약점도 스캔합니다. Dependabot 설정으로 pip·npm·docker·GitHub Actions 의존성 업데이트 PR이 매주 자동 생성됩니다.', isNew: true },
  { emoji: '🧪', title: '통합 테스트 스위트 (pytest + FastAPI TestClient)', desc: 'itsm-api/tests/ 하위에 65개 통합 테스트를 구성했습니다. SQLite 인메모리 DB(StaticPool)와 Redis 목(Mock)으로 외부 의존성 없이 로컬·CI에서 실행 가능합니다. RBAC 권한 검증, CRUD 흐름, 보안 입력 검증(LIKE 메타문자, CRLF 주입 등) 항목을 포함합니다. GitHub Actions tests.yml에서 PR마다 자동 실행됩니다.', isNew: true },
  { emoji: '📈', title: 'Rate Limit 메트릭 Prometheus 노출',               desc: 'Rate Limiting(429) 응답을 http_rate_limited_requests_total Prometheus Counter로 자동 집계합니다. HTTP 메서드·경로 레이블로 세분화되어 Grafana에서 어느 엔드포인트에서 속도 제한이 발생하는지 시각화할 수 있습니다.', isNew: true },
  { emoji: '🚀', title: 'Next.js 번들 최적화 (이미지·트리쉐이킹·캐시)',  desc: 'Next.js 프론트엔드에 여러 최적화를 적용했습니다. 이미지 자동 AVIF/WebP 변환(minimumCacheTTL 3600s), 정적 에셋 1년 불변 캐시(/_next/static/), experimental.optimizePackageImports로 @tiptap/react·@hello-pangea/dnd·react-markdown 번들 트리쉐이킹을 강화했습니다.', isNew: true },
  { emoji: '📋', title: 'API 계약 테스트 (test_api_contracts.py)',         desc: '10개 주요 엔드포인트(GET /tickets/, GET /tickets/{iid}, POST /admin/custom-fields 등)에 대한 응답 스키마 계약 테스트를 추가했습니다. 필수 키 존재 여부를 검증해 API 인터페이스 변경 시 즉시 감지합니다.', isNew: true },
  { emoji: '🎯', title: 'CI 커버리지 95% 임계값 강제',                   desc: 'pytest --cov-fail-under=95 옵션을 CI에 추가하여 전체 코드 커버리지가 95% 미만이면 빌드가 자동 실패합니다. export.py(66%→100%), comments.py(79%→100%), helpers.py(82%→100%) 등 주요 모듈 커버리지를 대폭 개선했습니다.', isNew: true },
  { emoji: '🔔', title: 'Grafana 알림 & 인시던트 대시보드',               desc: 'Prometheus ALERTS 메트릭을 시각화하는 5번째 Grafana 대시보드를 추가했습니다. Firing/Pending/Critical/Warning 알림 수, 알림 목록 테이블, 심각도 분포 파이차트, API 가용성 타임시리즈, HTTP 5xx 오류율 패널로 구성됩니다.', isNew: true },
]

/* ─── 워크플로우 & SLA 데이터 ────────────────────────────────────────── */

const SLA_ROWS = [
  { priority: '긴급', emoji: '🔴', response: 4,  resolve: 8,   desc: '업무 불가 / 즉시 조치 필요',  color: 'text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20',     example: '서버 다운, 전체 인터넷 불통' },
  { priority: '높음', emoji: '🟠', response: 8,  resolve: 24,  desc: '업무에 지장 있음',              color: 'text-orange-600 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20', example: '주요 업무시스템 오류' },
  { priority: '보통', emoji: '🟡', response: 24, resolve: 72,  desc: '불편하지만 업무 가능',          color: 'text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20', example: '업무 속도 저하, 일부 기능 이상' },
  { priority: '낮음', emoji: '⚪', response: 48, resolve: 168, desc: '일상 업무에 영향 없음',         color: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50',    example: '장비 교체 요청, 비업무 시간 대응' },
]

const WORKFLOW_NODES = [
  { id: 'open',              label: '접수됨',       emoji: '📥', color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-400 dark:border-yellow-600 text-yellow-800 dark:text-yellow-300',  note: null },
  { id: 'approved',          label: '승인완료',     emoji: '✅', color: 'bg-teal-50 dark:bg-teal-900/20 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-300',         note: '에이전트 승인 필요' },
  { id: 'in_progress',       label: '처리중',       emoji: '⚙️', color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-300',        note: null },
  { id: 'waiting',           label: '대기중',       emoji: '⏳', color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 text-purple-800 dark:text-purple-300',  note: 'SLA 일시정지' },
  { id: 'resolved',          label: '처리완료',     emoji: '🔧', color: 'bg-green-50 dark:bg-green-900/20 border-green-400 dark:border-green-600 text-green-800 dark:text-green-300',     note: null },
  { id: 'testing',           label: '테스트중',     emoji: '🧪', color: 'bg-violet-50 dark:bg-violet-900/20 border-violet-400 dark:border-violet-600 text-violet-800 dark:text-violet-300', note: null },
  { id: 'ready_for_release', label: '운영배포전',   emoji: '📦', color: 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300',     note: null },
  { id: 'released',          label: '운영반영완료', emoji: '🚀', color: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-400 dark:border-indigo-600 text-indigo-800 dark:text-indigo-300',  note: null },
  { id: 'closed',            label: '종료',         emoji: '🔒', color: 'bg-slate-50 dark:bg-slate-800/50 border-slate-400 dark:border-slate-600 text-slate-700 dark:text-slate-300',    note: null },
  { id: 'reopened',          label: '재개됨',       emoji: '🔄', color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-400 dark:border-orange-600 text-orange-800 dark:text-orange-300', note: '종료 후 재처리' },
]

const ESCALATION_ACTIONS = [
  { icon: '🔔', label: '알림 발송 (notify)',             desc: '담당자 및 관련 사용자에게 인앱·이메일·Telegram 알림을 즉시 발송합니다.' },
  { icon: '👤', label: '담당자 변경 (reassign)',          desc: '지정된 에이전트로 티켓 담당자를 자동으로 변경합니다.' },
  { icon: '⬆️', label: '우선순위 자동 상향 (upgrade_priority)', desc: '티켓 우선순위를 한 단계 자동 상향합니다 (예: 보통 → 높음).' },
]

/* ─── 권한 데이터 ─────────────────────────────────────────────────────── */

const PERMISSION_ROWS: { feature: string; user: string; dev: string; pl: string; agent: string; admin: string; isNew?: boolean }[] = [
  { feature: '고객 포털 티켓 접수 (비로그인 가능)',      user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 생성',                               user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '본인 티켓 조회·댓글',                     user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '만족도 평가',                             user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '지식베이스 열람',                         user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '칸반 보드 조회',                          user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '칸반 드래그 전환 규칙 (상태 제한)',        user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '필터 저장 (즐겨찾기)',                    user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '글로벌 검색 (⌘K)',                        user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 구독 (Watcher)',                     user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: 'KB 자동 추천',                            user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: 'Confidential 티켓 생성',                  user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '키보드 단축키',                           user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '공지사항 열람',                           user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '개인 알림 설정',                          user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '할당된 티켓 조회',                        user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 수정 (제목·내용·카테고리)',          user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 상태 변경',                          user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '내부 메모 작성',                          user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '개발 프로젝트 전달',                      user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '연관 티켓·시간 기록',                    user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: 'GitLab MR 연결 조회',                    user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '지식베이스 작성·편집',                   user: '—',  dev: '—',  pl: '✅', agent: '✅', admin: '✅' },
  { feature: '빠른 답변 조회',                          user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅' },
  { feature: '티켓 복제(Clone)',                        user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '타임라인 뷰 (댓글+감사로그 통합)',        user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '첨부파일 인라인 미리보기',                user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '해결 노트 작성',                          user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '전체 티켓 조회·신청자 필터',              user: '—',  dev: '—',  pl: '✅', agent: '✅', admin: '✅' },
  { feature: '담당자 변경',                             user: '—',  dev: '—',  pl: '✅', agent: '✅', admin: '✅' },
  { feature: '일괄 작업 (종료·배정·우선순위)',          user: '—',  dev: '—',  pl: '✅', agent: '✅', admin: '✅' },
  { feature: '리포트 & 에이전트 성과',                 user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅' },
  { feature: '감사 로그 열람',                          user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅' },
  { feature: '빠른 답변 생성·수정·삭제',               user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅' },
  { feature: 'CSV 내보내기 (티켓)',                     user: '—',  dev: '—',  pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '지식베이스 삭제',                         user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: '사용자 역할 관리',                        user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: 'SLA 정책 관리',                           user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: 'SLA 에스컬레이션 정책 관리',              user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: '이메일 템플릿 관리',                      user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: '서비스 유형 관리',                        user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: '자동 배정 규칙 관리',                    user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: '티켓 템플릿 관리',                        user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: '티켓 삭제',                               user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅' },
  { feature: 'API 키 관리',                             user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '아웃바운드 웹훅 관리',                    user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '공지사항 관리',                           user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '세션 관리 (강제 종료)',                   user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: 'Sudo 모드 (관리자 재인증)',                user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '비즈니스 KPI 대시보드 (Grafana)',          user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: 'GitLab 라벨 동기화 관리',                  user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '서비스 유형 삭제 보호 (사용 현황 표시)',    user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '구독 중인 티켓 목록 조회 및 취소',          user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '해결 노트 → KB 아티클 변환',               user: '—',  dev: '—',  pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: 'GitLab 마일스톤 설정 (티켓)',               user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '티켓 승인 (open → approved)',               user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅', isNew: true },
  { feature: '승인 자기 처리 (자신의 요청 승인/거절)',      user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅', isNew: true },
  { feature: '커스텀 필드 값 입력 (티켓 추가 정보)',      user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅', isNew: true },
  { feature: '커스텀 필드 정의 관리',                      user: '—',  dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '티켓 병합 (중복 티켓 → 대상으로 병합)',      user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅', isNew: true },
  { feature: '@멘션 (댓글 에디터)',                         user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: 'PII 마스킹 해제 (원본 내용 조회)',            user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅', isNew: true },
  { feature: 'DORA 4대 지표 리포트',                        user: '—',  dev: '—',  pl: '—',  agent: '✅', admin: '✅', isNew: true },
  { feature: '티켓 유형 설정 (incident/service_request/change/problem)', user: '—', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '문제 관리 패널 (problem_of 인시던트 링크)',   user: '—',  dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '대시보드 위젯 커스터마이징 (개인 설정)',       user: '✅', dev: '✅', pl: '✅', agent: '✅', admin: '✅', isNew: true },
  { feature: '서비스 카탈로그 관리 (/admin/service-catalog)', user: '—', dev: '—',  pl: '—',  agent: '—',  admin: '✅', isNew: true },
  { feature: '자동화 규칙 엔진 관리 (/admin/automation-rules)', user: '—', dev: '—', pl: '—', agent: '—', admin: '✅', isNew: true },
]

/* ─── 비교 매트릭스 데이터 ───────────────────────────────────────────── */

const COMPARISON_SECTIONS: { category: string; rows: { feature: string; itsm: string; zammad: string; glpi: string; jira: string; sn: string; isNew?: boolean }[] }[] = [
  {
    category: '티켓 관리',
    rows: [
      { feature: '티켓 CRUD + 파일 첨부',                  itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
      { feature: '상태 워크플로우 (10단계)',                  itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅' },
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
      { feature: '커스텀 필드 (확장 입력 필드 정의)',       itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
      { feature: '티켓 승인 워크플로우',                    itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '티켓 병합 (중복 → 대상으로 댓글 이전)',   itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '@멘션 (댓글 에디터 + 인앱 알림)',          itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
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
      { feature: '자동화 규칙 엔진 (트리거·조건·액션 JSONB)', itsm: '✅', zammad: '✅', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '서비스 카탈로그 (포털 연동·필드 스키마)',   itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
      { feature: '티켓 유형 분류 (ITIL — incident/sr/change/problem)', itsm: '✅', zammad: '⚠️', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
      { feature: '문제 관리 (Problem Management / 인시던트 연결)', itsm: '✅', zammad: '❌', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
      { feature: '대시보드 위젯 개인 커스터마이징 (서버 저장)', itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅', isNew: true },
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
      { feature: 'DORA 4대 지표 (배포빈도·리드타임·CFR·MTTR)', itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
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
      { feature: '5단계 RBAC (user·developer·pl·agent·admin)', itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
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
      { feature: 'PII 자동 탐지·마스킹 (6개 패턴)',         itsm: '✅', zammad: '❌', glpi: '❌', jira: '❌', sn: '⚠️', isNew: true },
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
      { feature: 'GitLab 마일스톤 연동 (티켓)',             itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '❌', isNew: true },
      { feature: 'GitLab 이슈 수정 → ITSM 감사 로그 (양방향 동기화)', itsm: '✅', zammad: '❌', glpi: '❌', jira: '⚠️', sn: '⚠️', isNew: true },
      { feature: 'GitLab 코멘트 → 담당자 전원 인앱 알림',  itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
    ],
  },
  {
    category: '인프라 & 운영',
    rows: [
      { feature: 'Docker Compose 배포',                    itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '❌' },
      { feature: 'Prometheus 메트릭 (/metrics)',            itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '✅' },
      { feature: 'Grafana 자동 프로비저닝 대시보드 5개',   itsm: '✅', zammad: '❌', glpi: '❌', jira: '✅', sn: '✅', isNew: true },
      { feature: 'ClamAV 바이러스 스캔 (상시)',            itsm: '✅', zammad: '❌', glpi: '⚠️', jira: '❌', sn: '✅', isNew: true },
      { feature: 'PostgreSQL 자동 백업',                   itsm: '✅', zammad: '⚠️', glpi: '⚠️', jira: '✅', sn: '✅' },
      { feature: 'GitLab CI/CD 파이프라인',                itsm: '✅', zammad: '⚠️', glpi: '❌', jira: '✅', sn: '✅' },
      { feature: 'Alembic 마이그레이션 (52단계)',          itsm: '✅', zammad: '✅', glpi: '✅', jira: '✅', sn: '✅', isNew: true },
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
    color: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-900/20',
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
    color: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800', bg: 'bg-green-50 dark:bg-green-900/20',
    endpoints: [
      { method: 'GET',    path: '/tickets',                   desc: '목록 조회 (필터·페이지네이션)' },
      { method: 'POST',   path: '/tickets',                   desc: '티켓 생성 (confidential 체크박스 포함)' },
      { method: 'GET',    path: '/tickets/search',            desc: '전문 검색 (?q=키워드, 글로벌 ⌘K 검색 연동)' },
      { method: 'GET',    path: '/tickets/export/csv',        desc: '현재 필터 기준 CSV 다운로드 (agent 이상, UTF-8 BOM)', isNew: true },
      { method: 'GET',    path: '/tickets/{iid}',             desc: '상세 조회' },
      { method: 'PATCH',  path: '/tickets/{iid}',             desc: '수정 (상태·담당자·제목 등)' },
      { method: 'DELETE', path: '/tickets/{iid}',             desc: '삭제 (admin 전용)' },
      { method: 'POST',   path: '/tickets/{iid}/clone',       desc: '티켓 복제 (제목·카테고리·우선순위·본문 복사, related 링크 자동 연결)', isNew: true },
      { method: 'POST',   path: '/tickets/{iid}/merge',       desc: '티켓 병합 (?target_iid=N — 소스 댓글을 대상에 복사 후 closed, agent 이상)', isNew: true },
      { method: 'GET',    path: '/tickets/{iid}/comments',    desc: '댓글 목록' },
      { method: 'POST',   path: '/tickets/{iid}/comments',    desc: '댓글 작성 (내부 메모 포함)' },
      { method: 'POST',   path: '/tickets/{iid}/attachments', desc: '파일 첨부 업로드 (EXIF 자동 제거, ClamAV 스캔)' },
      { method: 'GET',    path: '/tickets/{iid}/links',       desc: '연관 티켓 목록' },
      { method: 'GET',    path: '/tickets/{iid}/linked-mrs',  desc: 'GitLab MR 연결 목록' },
      { method: 'GET',    path: '/tickets/{iid}/forwards',    desc: '개발 프로젝트 전달 이력' },
      { method: 'POST',   path: '/tickets/bulk',              desc: '일괄 작업 (종료·배정·우선순위)' },
      { method: 'GET',    path: '/tickets/{iid}/watchers',    desc: '구독자(Watcher) 목록 조회' },
      { method: 'POST',   path: '/tickets/{iid}/watch',       desc: '티켓 구독 (멱등: 중복 호출 무시)' },
      { method: 'DELETE', path: '/tickets/{iid}/watch',             desc: '티켓 구독 취소' },
      { method: 'GET',    path: '/tickets/{iid}/custom-fields',   desc: '티켓 커스텀 필드 값 목록 조회 (활성 필드 + 저장된 값 반환)', isNew: true },
      { method: 'PUT',    path: '/tickets/{iid}/custom-fields',   desc: '티켓 커스텀 필드 값 일괄 저장 (upsert, agent 이상)', isNew: true },
    ],
  },
  {
    id: 'kb', emoji: '📚', name: '지식베이스 (KB)', baseUrl: '/kb',
    color: 'text-purple-700 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800', bg: 'bg-purple-50 dark:bg-purple-900/20',
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
    color: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-900/20',
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
      { method: 'GET',    path: '/admin/custom-fields',              desc: '커스텀 필드 정의 목록 조회 (include_disabled 파라미터 지원)', isNew: true },
      { method: 'POST',   path: '/admin/custom-fields',              desc: '커스텀 필드 정의 생성 (admin 전용)', isNew: true },
      { method: 'PATCH',  path: '/admin/custom-fields/{id}',         desc: '커스텀 필드 수정 (label·options·required·enabled·sort_order)', isNew: true },
      { method: 'DELETE', path: '/admin/custom-fields/{id}',         desc: '커스텀 필드 삭제 (ticket_custom_values cascade 삭제)', isNew: true },
    ],
  },
  {
    id: 'reports', emoji: '📊', name: '보고서 (Reports)', baseUrl: '/reports',
    color: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', bg: 'bg-orange-50 dark:bg-orange-900/20',
    endpoints: [
      { method: 'GET', path: '/reports/current-stats',     desc: '실시간 통계 (신규·처리중·완료·SLA 위반)' },
      { method: 'GET', path: '/reports/trends',            desc: '일별 스냅샷 추이 (DailyStatsSnapshot)' },
      { method: 'GET', path: '/reports/breakdown',         desc: '상태·카테고리·우선순위별 분포' },
      { method: 'GET', path: '/reports/ratings',           desc: '만족도 별점 통계 및 분포' },
      { method: 'GET', path: '/reports/agent-performance', desc: '에이전트별 성과 (처리 건수·SLA 달성률·평점)' },
      { method: 'GET', path: '/reports/export',            desc: '티켓 CSV 내보내기 (현재 필터 적용)' },
      { method: 'GET', path: '/reports/dora',              desc: 'DORA 4대 지표 (?days=30, 배포빈도·리드타임·CFR·MTTR + 등급)', isNew: true },
    ],
  },
  {
    id: 'filters', emoji: '🔖', name: '필터 (Filters)', baseUrl: '/filters',
    color: 'text-teal-700 dark:text-teal-400', border: 'border-teal-200 dark:border-teal-800', bg: 'bg-teal-50 dark:bg-teal-900/20',
    endpoints: [
      { method: 'GET',    path: '/filters',      desc: '저장된 즐겨찾기 필터 목록' },
      { method: 'POST',   path: '/filters',      desc: '필터 저장' },
      { method: 'DELETE', path: '/filters/{id}', desc: '필터 삭제' },
    ],
  },
  {
    id: 'notifications', emoji: '🔔', name: '알림 (Notifications)', baseUrl: '/notifications',
    color: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-800', bg: 'bg-yellow-50 dark:bg-yellow-900/20',
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
    color: 'text-pink-700 dark:text-pink-400', border: 'border-pink-200 dark:border-pink-800', bg: 'bg-pink-50 dark:bg-pink-900/20',
    endpoints: [
      { method: 'GET',    path: '/quick-replies',      desc: '목록 조회 (developer 이상)' },
      { method: 'POST',   path: '/quick-replies',      desc: '생성 (agent 이상)' },
      { method: 'PUT',    path: '/quick-replies/{id}', desc: '수정 (agent 이상)' },
      { method: 'DELETE', path: '/quick-replies/{id}', desc: '삭제 (agent 이상)' },
    ],
  },
  {
    id: 'projects', emoji: '📁', name: '프로젝트 (Projects)', baseUrl: '/projects',
    color: 'text-indigo-700 dark:text-indigo-400', border: 'border-indigo-200 dark:border-indigo-800', bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    endpoints: [
      { method: 'GET', path: '/projects/{project_id}/milestones', desc: '활성 GitLab 마일스톤 목록 조회 (id·iid·title·description·due_date, state 파라미터로 active/closed 필터)', isNew: true },
    ],
  },
  {
    id: 'ticket-types', emoji: '🏷️', name: '티켓 유형 (Ticket Types)', baseUrl: '/ticket-types',
    color: 'text-violet-700 dark:text-violet-400', border: 'border-violet-200 dark:border-violet-800', bg: 'bg-violet-50 dark:bg-violet-900/20',
    endpoints: [
      { method: 'GET',  path: '/ticket-types/{iid}',      desc: '티켓 유형 메타 조회 (ticket_type·problem_ticket_iids)', isNew: true },
      { method: 'PUT',  path: '/ticket-types/{iid}',      desc: '티켓 유형 설정 (developer 이상, ticket_type 변경)', isNew: true },
      { method: 'GET',  path: '/ticket-types',            desc: '여러 티켓 유형 일괄 조회 (?ticket_iids=1,2,3, 최대 200건)', isNew: true },
    ],
  },
  {
    id: 'service-catalog', emoji: '📦', name: '서비스 카탈로그 (Service Catalog)', baseUrl: '/service-catalog',
    color: 'text-teal-700 dark:text-teal-400', border: 'border-teal-200 dark:border-teal-800', bg: 'bg-teal-50 dark:bg-teal-900/20',
    endpoints: [
      { method: 'GET',    path: '/service-catalog/public',  desc: '활성 카탈로그 목록 (비로그인 공개 — 포털용)', isNew: true },
      { method: 'GET',    path: '/service-catalog',         desc: '전체 카탈로그 목록 (인증 필요)', isNew: true },
      { method: 'POST',   path: '/service-catalog',         desc: '카탈로그 항목 생성 (admin, fields_schema JSONB)', isNew: true },
      { method: 'PATCH',  path: '/service-catalog/{id}',    desc: '카탈로그 항목 수정 (admin)', isNew: true },
      { method: 'DELETE', path: '/service-catalog/{id}',    desc: '카탈로그 항목 삭제 (admin)', isNew: true },
    ],
  },
  {
    id: 'dashboard', emoji: '🎛️', name: '대시보드 (Dashboard)', baseUrl: '/dashboard',
    color: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', bg: 'bg-amber-50 dark:bg-amber-900/20',
    endpoints: [
      { method: 'GET', path: '/dashboard/config', desc: '사용자별 위젯 설정 조회 (없으면 기본값 반환)', isNew: true },
      { method: 'PUT', path: '/dashboard/config', desc: '사용자별 위젯 설정 저장 (widgets JSONB 배열)', isNew: true },
    ],
  },
  {
    id: 'automation-rules', emoji: '⚙️', name: '자동화 규칙 (Automation Rules)', baseUrl: '/automation-rules',
    color: 'text-rose-700 dark:text-rose-400', border: 'border-rose-200 dark:border-rose-800', bg: 'bg-rose-50 dark:bg-rose-900/20',
    endpoints: [
      { method: 'GET',    path: '/automation-rules',          desc: '자동화 규칙 목록 (admin, order 순 정렬)', isNew: true },
      { method: 'POST',   path: '/automation-rules',          desc: '자동화 규칙 생성 (admin, trigger_event·conditions·actions JSONB)', isNew: true },
      { method: 'GET',    path: '/automation-rules/{id}',     desc: '자동화 규칙 상세 조회 (admin)', isNew: true },
      { method: 'PATCH',  path: '/automation-rules/{id}',     desc: '자동화 규칙 수정 (admin, JSONB 조건·액션 업데이트)', isNew: true },
      { method: 'DELETE', path: '/automation-rules/{id}',     desc: '자동화 규칙 삭제 (admin)', isNew: true },
    ],
  },
  {
    id: 'portal', emoji: '🌐', name: '고객 포털 (Portal)', baseUrl: '/portal',
    color: 'text-teal-700 dark:text-teal-400', border: 'border-teal-200 dark:border-teal-800', bg: 'bg-teal-50 dark:bg-teal-900/20',
    endpoints: [
      { method: 'POST', path: '/portal/submit',        desc: '비로그인 티켓 제출 (이름·이메일·제목·내용·카테고리·긴급도) — Rate Limit 5/분' },
      { method: 'GET',  path: '/portal/track/{token}', desc: '게스트 토큰으로 티켓 상태 조회 (인증 불필요)' },
    ],
  },
  {
    id: 'approvals', emoji: '✅', name: '승인 (Approvals)', baseUrl: '/approvals',
    color: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800', bg: 'bg-green-50 dark:bg-green-900/20',
    endpoints: [
      { method: 'GET',  path: '/approvals',                 desc: '승인 요청 목록 조회 (?ticket_iid=N&status=pending 필터, agent 이상)', isNew: true },
      { method: 'POST', path: '/approvals',                 desc: '승인 요청 생성 (티켓 IID·프로젝트 ID·승인자 username)', isNew: true },
      { method: 'POST', path: '/approvals/{id}/approve',    desc: '승인 처리 (agent 이상, 자기 승인 허용, 사유 선택입력)', isNew: true },
      { method: 'POST', path: '/approvals/{id}/reject',     desc: '거절/취소 처리 (agent 이상 또는 요청자 본인 취소 가능, 사유 선택입력)', isNew: true },
    ],
  },
  {
    id: 'ip-allowlist', emoji: '🛡️', name: 'IP 허용목록 (IP Allowlist)', baseUrl: '/ip-allowlist',
    color: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-900/20',
    endpoints: [
      { method: 'GET',    path: '/ip-allowlist',          desc: 'IP 허용목록 조회 (admin)', isNew: true },
      { method: 'POST',   path: '/ip-allowlist',          desc: 'IP/CIDR 추가 (admin)', isNew: true },
      { method: 'DELETE', path: '/ip-allowlist/{id}',     desc: 'IP 항목 삭제 (admin)', isNew: true },
      { method: 'GET',    path: '/ip-allowlist/my-ip',    desc: '현재 접속 IP 조회 (인증 필요)', isNew: true },
    ],
  },
]

const METHOD_BADGE: Record<HttpMethod, string> = {
  GET:    'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700',
  POST:   'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700',
  PATCH:  'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-700',
  PUT:    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-700',
  DELETE: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700',
}

/* ─── 아키텍처 데이터 ─────────────────────────────────────────────────── */

const SW_COMPONENTS = [
  {
    emoji: '🔀', name: 'Nginx', version: '1.27',
    category: '네트워크', badge: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200',
    border: 'border-green-300 dark:border-green-700', bg: 'bg-green-50 dark:bg-green-900/20',
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
    category: '프론트엔드', badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200',
    border: 'border-blue-300 dark:border-blue-700', bg: 'bg-blue-50 dark:bg-blue-900/20',
    role: '웹 프론트엔드 클라이언트',
    desc: 'App Router 기반의 React 18 웹 클라이언트로, Tailwind CSS로 스타일링합니다. standalone 빌드로 Docker 이미지 크기를 최소화하고, EventSource API로 SSE 알림을 실시간 수신합니다.',
    details: [
      'TypeScript + React 18 (서버·클라이언트 컴포넌트)',
      'Tailwind CSS (유틸리티 우선 스타일링)',
      '@hello-pangea/dnd (칸반 드래그앤드롭)',
      'TipTap 2.x: WYSIWYG 리치 텍스트 에디터 (Bold/Italic/코드블록/표/이미지/@ 멘션)',
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
    category: '백엔드 API', badge: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200',
    border: 'border-yellow-300 dark:border-yellow-700', bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    role: 'REST API 서버 · 비즈니스 로직',
    desc: 'ITSM의 핵심 비즈니스 로직을 처리하는 비동기 API 서버입니다. SLA 체커·스냅샷 스케줄러·사용자 동기화가 백그라운드 스레드로 동작하고, slowapi로 Rate Limiting, prometheus-fastapi-instrumentator로 메트릭을 제공합니다.',
    details: [
      'SQLAlchemy 2.0 ORM + Alembic 마이그레이션 (0001~0052, 52단계)',
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
      'JWT Access(2h) + Refresh Token(7일) 이중 인증 + Token Rotation',
      'Jinja2 이메일 템플릿 렌더링: DB 우선, 없으면 하드코딩 폴백',
      'MAX_ACTIVE_SESSIONS=5: 세션 초과 시 오래된 세션 자동 폐기',
      'httpx 공유 커넥션 풀 (max_connections=30): GitLab API 요청 TCP 재사용',
      'label_sync 쿨다운 5분: 30초 주기 Prometheus 스크레이프 시 GitLab API 과호출 방지',
      'non-root 컨테이너 실행 (appuser): Dockerfile에 useradd로 전용 사용자 생성 후 USER 전환',
    ],
  },
  {
    emoji: '🐘', name: 'PostgreSQL 17', version: '17',
    category: '데이터베이스', badge: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200',
    border: 'border-indigo-300 dark:border-indigo-700', bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    role: '주 관계형 데이터베이스',
    desc: '티켓·사용자·SLA·KB·감사로그 등 모든 데이터를 저장합니다. KB 전문 검색에 GIN 인덱스(tsvector), 태그 필터에 ARRAY+GIN, 즐겨찾기 필터에 JSONB를 활용하여 고성능 검색을 구현합니다.',
    details: [
      'Alembic 마이그레이션 52단계 (0001~0052)',
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
    category: '캐시 · Pub/Sub', badge: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200',
    border: 'border-red-300 dark:border-red-700', bg: 'bg-red-50 dark:bg-red-900/20',
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
    category: '인증 · VCS', badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200',
    border: 'border-orange-300 dark:border-orange-700', bg: 'bg-orange-50 dark:bg-orange-900/20',
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
    category: '모니터링 (상시)', badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-200',
    border: 'border-orange-200 dark:border-orange-800', bg: 'bg-orange-50 dark:bg-orange-900/20',
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
    category: '모니터링 (상시)', badge: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200',
    border: 'border-purple-300 dark:border-purple-700', bg: 'bg-purple-50 dark:bg-purple-900/20',
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
      '대시보드 5: ITSM 알림 & 인시던트 (Firing/Pending/Critical 알림 현황, 5xx 오류율, API 가용성)',
      '자동 프로비저닝 (항상 기동)',
    ],
  },
  {
    emoji: '🦠', name: 'ClamAV', version: 'latest',
    category: '보안 스캔 (상시)', badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-200',
    border: 'border-red-200 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-900/20',
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
    emoji: '🟢',
    title: 'testing(테스트중) 상태 추가',
    severity: '개선',
    symptom: '처리완료(resolved) 후 바로 운영배포전으로 전환해야 하는 구조 — 테스트 단계를 별도 상태로 표현 불가',
    cause: 'testing 상태가 StatusEnum·VALID_TRANSITIONS·GitLab 라벨·프론트 전반에 미정의',
    fix: 'schemas.py StatusEnum에 TESTING 추가, tickets.py VALID_TRANSITIONS(resolved→testing→ready_for_release), gitlab_client.py status::testing 라벨(#8e44ad), notifications.py/admin.py/forwards.py 상태 맵 추가. 프론트: constants.ts·StatusBadge·Kanban(9열)·WorkflowStepper·홈 statTabs(10탭) 업데이트.',
  },
  {
    emoji: '🟢',
    title: 'PL(pl) 역할 추가 — 5단계 RBAC',
    severity: '개선',
    symptom: 'PL이 agent와 동일 권한을 사용 — 리포트·감사로그 등 IT 내부 기능 접근 차단 불가',
    cause: 'ROLE_LEVELS에 pl 레벨이 없어 agent 권한을 그대로 부여하는 구조',
    fix: 'rbac.py ROLE_LEVELS에 pl(레벨 2) 추가, require_pl 팩토리 생성. tickets.py·kb.py의 require_agent → require_pl 교체(티켓/KB 처리 허용). admin.py의 감사로그·SLA·리포트는 require_agent 유지(PL 차단). projects.py _ASSIGNABLE_ROLES에 pl 추가. 프론트: ROLES·ROLE_LABELS·AuthContext isDeveloper에 pl 반영. 사용자 관리 역할 통계 grid-cols-5 확장.',
  },
  {
    emoji: '🔴',
    title: 'problem_of 링크 유형 차단 버그 수정',
    severity: '심각',
    symptom: '티켓 유형을 "문제"로 설정 후 인시던트 연결 시 400 Bad Request 반환 — 문제 관리 기능 전체 동작 불가',
    cause: 'templates.py의 allowed_types 집합에 "problem_of" 링크 유형이 누락 ({"related", "blocks", "duplicate_of"} 3개만 허용)',
    fix: 'allowed_types에 "problem_of" 추가 → {"related", "blocks", "duplicate_of", "problem_of"}. itsm-api 이미지 재빌드 필요.',
  },
  {
    emoji: '🟠',
    title: '대시보드 위젯 설정 JSONB 저장 누락 수정',
    severity: '중간',
    symptom: '대시보드 위젯 설정 저장 후 새로고침 시 원래 값으로 복원 — PUT /dashboard/config가 DB에 반영 안됨',
    cause: 'SQLAlchemy ORM은 JSONB 컬럼에 새 dict/list를 할당해도 변경 감지를 못함. flag_modified() 호출 누락.',
    fix: 'dashboard.py PUT 엔드포인트에 flag_modified(config, "widgets") 추가. 새 레코드 생성 경로에서도 list() 복사로 개선.',
  },
  {
    emoji: '🟠',
    title: '자동화 규칙 조건·액션 JSONB 저장 누락 수정',
    severity: '중간',
    symptom: 'PATCH /automation-rules/{id}로 conditions·actions 수정 시 저장 안됨 — 새로고침하면 이전 값으로 복원',
    cause: 'automation.py PATCH 핸들러에서 JSONB 필드 setattr 후 flag_modified() 미호출',
    fix: 'jsonb_fields = {"conditions", "actions"} 집합 정의 후, 해당 필드 수정 시 flag_modified(rule, field) 호출 추가.',
  },
  {
    emoji: '🟠',
    title: '서비스 카탈로그 fields_schema JSONB 저장 누락 수정',
    severity: '중간',
    symptom: 'PATCH /service-catalog/{id}로 fields_schema 수정 시 저장 안됨 — 카탈로그 필드 스키마 편집 불가',
    cause: 'service_catalog.py PATCH 핸들러에서 fields_schema JSONB 필드 수정 후 flag_modified() 미호출',
    fix: 'fields_schema 필드 setattr 직후 flag_modified(item, "fields_schema") 추가.',
  },
  {
    emoji: '🟡',
    title: '티켓 유형·승인 패널 projectId 누락 수정',
    severity: '높음',
    symptom: 'URL에 ?project_id= 파라미터 없이 티켓 상세 직접 접근 시 TicketTypePanel·ApprovalPanel이 빈 projectId("")로 API 호출 → 프로젝트 없음 오류',
    cause: '티켓 상세 page.tsx에서 projectId = searchParams.get("project_id") || "" 를 그대로 전달 — 직접 URL 접근 시 항상 빈 문자열',
    fix: 'ticket?.project_id || projectId || "" 패턴으로 교체 — 로드된 티켓 데이터의 project_id를 우선 사용.',
  },
  {
    emoji: '🟡',
    title: '저장된 필터 pill 클릭 연결 누락 수정',
    severity: '낮음',
    symptom: '티켓 목록 저장된 필터 pill 클릭 시 필터가 적용되지 않음',
    cause: 'pill(<span>) 내부의 필터 이름 텍스트에 onClick이 없고 × 삭제 버튼만 연결된 상태',
    fix: '필터 이름 텍스트를 <button onClick={() => applyFilter(f)}>로 감싸 applyFilter 함수 연결.',
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
  /* ─── 2차 안정화 수정 (동시성·트랜잭션·프론트 수정) ─── */
  {
    emoji: '🔴',
    title: 'SLA 통계 컬럼명 오류 수정 (breached 항상 0 버그)',
    severity: '심각',
    symptom: '리포트 / SLA 통계 API에서 SLA 위반 건수가 항상 0으로 표시됨',
    cause: 'tickets.py SLA 통계 쿼리에서 SLARecord.is_breached를 참조했으나, 실제 모델 컬럼명은 SLARecord.breached임',
    fix: 'tickets.py SLA 통계 집계 쿼리의 SLARecord.is_breached → SLARecord.breached 수정. 즉시 정확한 위반 건수 반영.',
  },
  {
    emoji: '🟠',
    title: 'list_tickets 내부 별도 DB 세션 생성 → 기존 세션 재사용',
    severity: '중간',
    symptom: '티켓 목록 API 호출 시 DB 커넥션 이중 소비. 부하 시 커넥션 풀 고갈 가능성',
    cause: 'list_tickets 라우터 내부에서 SessionLocal()로 신규 세션을 추가 생성. Depends(get_db)로 이미 주입된 db 세션을 무시한 구조',
    fix: 'SessionLocal() 제거 후 이미 주입된 db 세션을 그대로 재사용. DB 커넥션 소비 절반으로 감소.',
  },
  {
    emoji: '🟠',
    title: '@멘션 N+1 쿼리 최적화 + 알림 트랜잭션 commit 누락',
    severity: '중간',
    symptom: '댓글 @멘션 시 멘션 대상자 수만큼 SELECT 쿼리 발생 (N+1). 간헐적으로 @멘션 알림이 저장되지 않음',
    cause: '멘션 대상자를 개별 SELECT로 반복 조회. 알림 생성 후 _db.commit() 호출 누락으로 일부 상황에서 롤백',
    fix: 'IN 쿼리로 멘션 대상자 일괄 조회 (N+1 → 1쿼리). 알림 생성 루프 후 _db.commit() 명시적 추가.',
  },
  {
    emoji: '🟠',
    title: 'create_db_notification db.commit() → db.flush() 변경',
    severity: '중간',
    symptom: '외부 트랜잭션 진행 중 알림 생성 시 트랜잭션이 예상치 않게 커밋되어 원자성 손상 가능',
    cause: 'create_db_notification()가 db.commit()을 직접 호출. 이 함수가 외부 트랜잭션 내에서 호출될 때 외부 트랜잭션을 강제 커밋하는 부작용 발생',
    fix: 'db.commit() → db.flush()로 변경. PK 할당·created_at 설정은 그대로 유지하면서 외부 트랜잭션 원자성 보장.',
  },
  {
    emoji: '🟡',
    title: 'resume_sla 동시성 취약점 수정 (with_for_update + 음수 방지)',
    severity: '높음',
    symptom: '동시에 여러 요청이 SLA 재개를 호출할 경우 pause_seconds가 중복 계산될 수 있음. 드물게 음수 pause_seconds 발생 가능',
    cause: 'resume_sla() 함수에 with_for_update() 미적용으로 TOCTOU 경합 발생 가능. max(0, ...) 처리 없어 음수 값 저장 가능',
    fix: '.with_for_update()로 행 잠금하여 동시 재개 요청 직렬화. max(0, int(...)) 로 음수 pause_seconds 방지.',
  },
  {
    emoji: '🟠',
    title: 'IP 허용 목록 캐시 asyncio.Lock + double-check 패턴 적용',
    severity: '중간',
    symptom: '고부하 환경에서 IP 허용 목록 캐시가 동시에 여러 코루틴에 의해 중복 갱신될 수 있음',
    cause: '_ip_cache_lock 없이 캐시 만료 확인 → 재로드를 수행하여, 동시 요청 시 여러 코루틴이 동시에 DB 조회 및 캐시 업데이트 실행',
    fix: 'asyncio.Lock() 추가 + double-check 패턴 적용. 락 획득 후 재로드 필요 여부를 재확인하여 한 번만 실행 보장.',
  },
  {
    emoji: '🟡',
    title: 'IMAP 이메일 수신 시 GitLab 이슈 생성 실패 격리',
    severity: '높음',
    symptom: 'GitLab API 오류 발생 시 해당 이메일 처리 이후 모든 이메일 처리가 중단됨',
    cause: 'gitlab_client.create_issue() 실패 시 예외가 외부로 전파되어 수신함의 나머지 이메일을 처리하지 못함',
    fix: 'try/except로 create_issue() 호출 구간을 격리. 실패 시 에러 로그만 기록하고 continue로 다음 이메일 처리 계속.',
  },
  {
    emoji: '🟠',
    title: '승인 요청 중복 방지 쿼리 with_for_update() 추가',
    severity: '중간',
    symptom: '동시에 여러 승인 요청이 동일 티켓으로 들어올 경우 중복 pending 레코드가 생성될 수 있음',
    cause: '중복 확인 쿼리에 with_for_update() 미적용으로 TOCTOU 경합 발생. 두 요청이 동시에 "없음"을 확인하고 각각 삽입 가능',
    fix: '.with_for_update()를 중복 확인 쿼리에 추가하여 동시 승인 요청을 직렬화.',
  },
  {
    emoji: '🟡',
    title: '티켓 상세 setInterval cleanup 누락 수정',
    severity: '높음',
    symptom: '특정 상황에서 티켓 상세 페이지 이탈 후에도 setInterval이 계속 실행되어 백그라운드 API 호출 지속',
    cause: 'forwards.length를 useEffect dependency에 포함하여 forwards 변경 시마다 interval 재생성. 이전 interval의 cleanup이 누락되거나 늦게 실행되는 경합 발생',
    fix: 'dependency에서 forwards.length 제거. 안정적인 cleanup 패턴으로 교체하여 컴포넌트 언마운트 시 interval 확실히 제거.',
  },
  {
    emoji: '🟢',
    title: 'ApprovalPanel 에러 상태 UI 추가',
    severity: '낮음',
    symptom: '승인 패널 API 호출 실패 시 패널이 빈 상태로 표시되어 오류 여부를 알 수 없음',
    cause: 'ApprovalPanel 컴포넌트에 loadError 상태가 없어 API 실패 시 사용자에게 어떠한 피드백도 없음',
    fix: 'loadError useState 추가. API 실패 시 "승인 요청을 불러오지 못했습니다" 오류 메시지 표시.',
  },
  {
    emoji: '🟡',
    title: 'fetchRating API 인증 쿠키 누락 수정',
    severity: '중간',
    symptom: '만족도 평가 제출 또는 조회 시 인증되지 않은 오류(401) 발생 가능',
    cause: 'api.ts의 fetchRating 함수에 credentials: \'include\' 설정이 누락되어 itsm_token 쿠키가 요청에 포함되지 않음',
    fix: 'fetchRating 함수에 credentials: \'include\' 추가. 다른 인증 필요 API와 동일한 방식으로 통일.',
  },
]

const CONNECTIONS = [
  { from: '사용자 브라우저',         to: 'Nginx',                  protocol: 'HTTP',           port: ':8111',      direction: '→', detail: '단일 외부 진입점. 모든 요청이 이 포트를 통해 유입됩니다.', color: 'bg-gray-50 dark:bg-gray-800/50' },
  { from: 'Nginx',                    to: 'itsm-web (Next.js)',      protocol: 'HTTP',           port: ':3000',      direction: '→', detail: '/ 경로 → Next.js 웹 서버로 프록시. 웹소켓 Upgrade 헤더 전달 포함.', color: 'bg-blue-50 dark:bg-blue-900/20' },
  { from: 'Nginx',                    to: 'itsm-api (FastAPI)',      protocol: 'HTTP / SSE',     port: ':8000',      direction: '→', detail: '/api/ 경로 → FastAPI 서버. /api/notifications/stream 경로는 proxy_buffering off 적용.', color: 'bg-yellow-50 dark:bg-yellow-900/20' },
  { from: 'itsm-web',                 to: 'itsm-api',               protocol: 'HTTP REST + SSE', port: ':8111 경유', direction: '→', detail: 'API 데이터 요청(fetch) 및 EventSource로 SSE 알림 스트림 연결. JWT 쿠키 자동 포함.', color: 'bg-blue-50 dark:bg-blue-900/20' },
  { from: 'itsm-api',                 to: 'PostgreSQL',             protocol: 'TCP',            port: ':5432',      direction: '→', detail: 'SQLAlchemy ORM으로 모든 데이터 CRUD. 시작 시 alembic upgrade head 자동 마이그레이션.', color: 'bg-indigo-50 dark:bg-indigo-900/20' },
  { from: 'itsm-api',                 to: 'Redis',                  protocol: 'TCP',            port: ':6379',      direction: '→', detail: 'SSE 알림 이벤트 pub/sub 발행. 웹훅 UUID 중복 감지를 위한 SET 저장 (TTL 5분).', color: 'bg-red-50 dark:bg-red-900/20' },
  { from: 'itsm-api',                 to: 'GitLab API',             protocol: 'HTTP',           port: ':8929',      direction: '→', detail: 'OAuth 토큰 검증, 이슈 생성 (개발 전달), MR·이슈 조회, 그룹 멤버 목록 (사용자 동기화), 티켓 검색.', color: 'bg-orange-50 dark:bg-orange-900/20' },
  { from: 'itsm-api',                 to: 'ClamAV',                 protocol: 'TCP',            port: ':3310',      direction: '→', detail: '파일 업로드 시 ClamAV 데몬으로 바이러스 스캔 요청.', color: 'bg-red-50 dark:bg-red-900/20' },
  { from: 'GitLab',                   to: 'itsm-api',               protocol: 'HTTP POST',      port: ':8000/webhooks', direction: '←', detail: 'Push·MR·이슈 이벤트 웹훅 수신. X-Gitlab-Token 헤더로 검증. UUID 중복 방지.', color: 'bg-orange-50 dark:bg-orange-900/20' },
  { from: 'Redis',                    to: 'itsm-api (SSE 구독)',    protocol: 'TCP',            port: ':6379',      direction: '←', detail: '알림 발행 시 구독 중인 SSE 핸들러로 이벤트 전달 → 브라우저에 실시간 스트리밍.', color: 'bg-red-50 dark:bg-red-900/20' },
  { from: 'Prometheus',               to: 'itsm-api /metrics',      protocol: 'HTTP GET',       port: ':8000/metrics', direction: '←', detail: '60초 간격 스크래핑. prometheus-fastapi-instrumentator가 요청 수·응답 시간·에러율 노출.', color: 'bg-orange-50 dark:bg-orange-900/20' },
  { from: 'Grafana',                  to: 'Prometheus',             protocol: 'HTTP PromQL',    port: ':9090',      direction: '←', detail: 'Prometheus를 데이터소스로 연결. PromQL 쿼리로 시계열 메트릭 조회 및 대시보드 시각화.', color: 'bg-purple-50 dark:bg-purple-900/20' },
  { from: 'pg-backup',               to: 'PostgreSQL',             protocol: 'TCP',            port: ':5432',      direction: '→', detail: '24시간 주기로 pg_dump 실행 → /backups/itsm_YYYYMMDD.sql.gz 저장. 7일 경과 파일 자동 삭제.', color: 'bg-gray-50 dark:bg-gray-800/50' },
]

/* ─── FAQ 카테고리 메타데이터 ────────────────────────────────────────── */

const FAQ_CAT_MAP: Record<number, string> = {
  0: '기본 사용법', 1: '기본 사용법', 2: '기본 사용법',
  3: '관리자 설정', 4: '관리자 설정', 5: '관리자 설정',
  6: '기능 안내',   7: '기능 안내',   8: '기능 안내',
  9: '기능 안내',  10: '기능 안내',  11: '기능 안내',
  12: '보안',      13: '보안',
  14: '관리자 설정', 15: '관리자 설정', 16: '관리자 설정', 17: '관리자 설정',
  18: 'GitLab 연동',
  19: '기능 안내',  20: '기능 안내',  21: '기능 안내',  22: '기능 안내',
  23: '관리자 설정',
  24: '기능 안내',
  25: 'GitLab 연동', 26: '문제 해결', 27: '문제 해결',
  28: '권한/역할',
  29: '기본 사용법', 30: '기본 사용법', 31: '기본 사용법',
  32: 'GitLab 연동',
  33: '기능 안내',  34: '기능 안내',  35: '기능 안내',
  36: 'GitLab 연동', 37: 'GitLab 연동',
  38: '기능 안내',
  39: '관리자 설정', 40: '관리자 설정', 41: '관리자 설정', 42: '관리자 설정',
  43: '기능 안내',  44: '기능 안내',  45: '기능 안내',  46: '기능 안내',
  47: '보안',
  48: '기능 안내',
  49: '문제 해결',  50: '문제 해결',
  51: '기능 안내',
  52: '관리자 설정',
  53: '문제 해결',  54: '문제 해결',  55: '문제 해결',  56: '문제 해결',
  57: '문제 해결',  58: '문제 해결',  59: '문제 해결',  60: '문제 해결',
  61: '관리자 설정', 62: '관리자 설정',
  63: '권한/역할',
  64: '기능 안내',  65: '기능 안내',  66: '기능 안내',
  67: '관리자 설정',
  68: '기능 안내',  69: '기능 안내',
  70: '권한/역할',
  71: '기본 사용법',
  72: '문제 해결',
}

const FAQ_CAT_ORDER = ['기본 사용법', '기능 안내', 'GitLab 연동', '관리자 설정', '권한/역할', '보안', '문제 해결']

const FAQ_CAT_CONFIG: Record<string, { icon: string; color: string; bg: string; ring: string }> = {
  '기본 사용법': { icon: '🎫', color: 'text-blue-700 dark:text-blue-300',   bg: 'bg-blue-100 dark:bg-blue-900/40',   ring: 'border-blue-300 dark:border-blue-700' },
  '기능 안내':   { icon: '⚡', color: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-100 dark:bg-violet-900/40', ring: 'border-violet-300 dark:border-violet-700' },
  'GitLab 연동': { icon: '🦊', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/40', ring: 'border-orange-300 dark:border-orange-700' },
  '관리자 설정': { icon: '⚙️', color: 'text-gray-700 dark:text-gray-300',    bg: 'bg-gray-100 dark:bg-gray-800/60',    ring: 'border-gray-300 dark:border-gray-600' },
  '권한/역할':   { icon: '🔑', color: 'text-teal-700 dark:text-teal-300',    bg: 'bg-teal-100 dark:bg-teal-900/40',   ring: 'border-teal-300 dark:border-teal-700' },
  '보안':        { icon: '🛡️', color: 'text-red-700 dark:text-red-300',      bg: 'bg-red-100 dark:bg-red-900/40',     ring: 'border-red-300 dark:border-red-700' },
  '문제 해결':   { icon: '🔧', color: 'text-amber-700 dark:text-amber-300',  bg: 'bg-amber-100 dark:bg-amber-900/40', ring: 'border-amber-300 dark:border-amber-700' },
}

/* ─── 헬퍼 컴포넌트 ──────────────────────────────────────────────────── */

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
        {number}
      </div>
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{title}</h2>
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
    value === '✅' ? 'text-green-600 dark:text-green-400 font-bold' :
    value === '⚠️' ? 'text-yellow-600 dark:text-yellow-400' :
    value === '❌' ? 'text-red-400 dark:text-red-400' :
    'text-gray-400 dark:text-gray-500 text-xs'
  return <td className={`py-2 px-2 text-center text-sm ${cls}`}>{value}</td>
}

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded font-mono shrink-0 w-16 text-center ${METHOD_BADGE[method]}`}>
      {method}
    </span>
  )
}

/* ─── FAQ 답변 렌더러 ────────────────────────────────────────────────── */

function AnswerContent({ text }: { text: string }) {
  type Block =
    | { type: 'text'; content: string }
    | { type: 'bullet'; items: string[] }
    | { type: 'numbered'; items: Array<{ num: string; content: string }> }

  const blocks: Block[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) { i++; continue }

    if (trimmed.startsWith('•')) {
      const items: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('•')) {
        items.push(lines[i].trim().slice(1).trim())
        i++
      }
      blocks.push({ type: 'bullet', items })
      continue
    }

    const circMatch = trimmed.match(/^([①②③④⑤⑥⑦⑧⑨])/)
    if (circMatch) {
      const items: Array<{ num: string; content: string }> = []
      while (i < lines.length) {
        const m = lines[i].trim().match(/^([①②③④⑤⑥⑦⑧⑨])(.*)/)
        if (!m) break
        items.push({ num: m[1], content: m[2].trim() })
        i++
      }
      blocks.push({ type: 'numbered', items })
      continue
    }

    blocks.push({ type: 'text', content: trimmed })
    i++
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        if (block.type === 'text') {
          return (
            <p key={bi} className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {block.content}
            </p>
          )
        }
        if (block.type === 'bullet') {
          return (
            <ul key={bi} className="space-y-1.5 pl-1">
              {block.items.map((item, ii) => (
                <li key={ii} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-teal-400 dark:bg-teal-500 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === 'numbered') {
          return (
            <ol key={bi} className="space-y-1.5 pl-1">
              {block.items.map((item, ii) => (
                <li key={ii} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-xs font-bold inline-flex items-center justify-center">
                    {item.num}
                  </span>
                  <span>{item.content}</span>
                </li>
              ))}
            </ol>
          )
        }
        return null
      })}
    </div>
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
          <div className="space-y-0">
            {REGISTRATION_STEPS.map((s, i) => (
              <div key={s.step} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                    {s.step}
                  </div>
                  {i < REGISTRATION_STEPS.length - 1 && <div className="w-0.5 flex-1 bg-blue-100 dark:bg-blue-900/30 my-1" />}
                </div>
                <div className={`pb-6 flex-1 ${i === REGISTRATION_STEPS.length - 1 ? 'pb-0' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.icon}</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-100">{s.title}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{s.desc}</p>
                  {s.tip && (
                    <div className="mt-2 flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                      <span className="text-blue-500 dark:text-blue-400 text-xs shrink-0 mt-0.5">💡 TIP</span>
                      <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">{s.tip}</p>
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            카테고리(서비스 유형)는 시스템관리자가 관리 메뉴에서 동적으로 추가·수정할 수 있습니다. 아래는 기본 제공 카테고리 예시입니다.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CATEGORIES_INFO.map((cat) => (
              <div key={cat.label} className={`border-2 rounded-xl p-4 ${cat.color}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{cat.emoji}</span>
                  <span className="font-bold text-gray-800 dark:text-gray-100">{cat.label}</span>
                </div>
                <ul className="space-y-1">
                  {cat.examples.map((ex) => (
                    <li key={ex} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1">
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-gray-500 dark:text-gray-400">입력 필드(텍스트 박스, 에디터 등)에서는 단축키가 자동으로 비활성화됩니다.</span>
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
              <div key={s.key} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                <kbd className="inline-flex items-center px-2 py-1 rounded bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 shadow-sm font-mono text-xs text-gray-700 dark:text-gray-300 shrink-0 min-w-[80px] justify-center">
                  {s.key}
                </kbd>
                <span className="text-sm text-gray-600 dark:text-gray-400">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 역할 요약 */}
      <section className="mb-10">
        <SectionTitle number="4" title="역할(Role) 요약" />
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { role: '일반 사용자', emoji: '👤', color: 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50', desc: '티켓 등록·조회·평가. 본인 티켓만 열람합니다.' },
              { role: '개발자', emoji: '💻', color: 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20', desc: '할당된 티켓 처리. 내부 메모 작성. 칸반 접근.' },
              { role: 'PL', emoji: '🗂️', color: 'border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/20', desc: '전체 티켓 조회·수정, KB 작성, 담당자 변경, 일괄 작업. 리포트·감사로그 제외.' },
              { role: 'IT 담당자', emoji: '🎧', color: 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20', desc: '리포트·에이전트 성과·감사로그 포함 전체 운영 권한.' },
              { role: '시스템관리자', emoji: '⚙️', color: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20', desc: '사용자 역할, SLA 정책, 에스컬레이션, API 키 등 전체 관리.' },
            ].map((r) => (
              <div key={r.role} className={`border-2 rounded-xl p-4 ${r.color}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{r.emoji}</span>
                  <span className="font-bold text-sm text-gray-800 dark:text-gray-100">{r.role}</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 역할별 시작 가이드 */}
      <section className="mb-10">
        <SectionTitle number="5" title="역할별 시작 가이드 — 따라하기" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">내 역할에 맞는 가이드를 따라하면 빠르게 ZENITH에 익숙해질 수 있습니다.</p>
        <div className="space-y-4">
          {([
            {
              role: '👤 일반 사용자 (현업)',
              color: 'border-gray-300 dark:border-gray-600',
              headerBg: 'bg-gray-50 dark:bg-gray-800/50',
              steps: [
                { num: '1', title: '첫 로그인', desc: 'GitLab 계정으로 로그인합니다. GitLab 아이디와 비밀번호를 그대로 사용합니다.' },
                { num: '2', title: '티켓 등록', desc: '헤더의 "+ 티켓 등록" 버튼 또는 단축키 n을 눌러 새 티켓을 작성합니다. 서비스 유형·제목·내용·우선순위를 입력하고 제출합니다.' },
                { num: '3', title: '진행 상황 확인', desc: '티켓 목록 또는 홈 화면에서 내 티켓의 상태를 확인합니다. SLA 배지(🟢/🟡/🟠/🔴)로 처리 기한을 파악할 수 있습니다.' },
                { num: '4', title: '댓글로 소통', desc: '담당자로부터 추가 정보 요청이 올 경우 티켓 상세 화면에서 댓글로 답변합니다.' },
                { num: '5', title: '완료 확인 및 평가', desc: '"처리완료" 상태의 티켓을 확인하고 문제가 없으면 "종료" 처리합니다. 별점(1~5)과 한 줄 코멘트로 만족도를 남겨 주세요.' },
              ],
              tip: 'GitLab 계정 없이 IT 지원을 요청하려면 /portal (고객 셀프서비스 포털)을 이용하세요.',
            },
            {
              role: '💻 개발자',
              color: 'border-blue-300 dark:border-blue-700',
              headerBg: 'bg-blue-50 dark:bg-blue-900/20',
              steps: [
                { num: '1', title: '내 할당 티켓 확인', desc: '티켓 목록에서 "내 담당" 필터를 선택하거나, 홈 화면 "내 담당 티켓" 위젯으로 본인에게 배정된 티켓을 파악합니다.' },
                { num: '2', title: '칸반 보드 활용', desc: 'g → k 단축키 또는 헤더 "칸반" 메뉴로 이동합니다. 카드를 드래그하여 처리 상태를 직접 변경합니다.' },
                { num: '3', title: '댓글 및 내부 메모 작성', desc: '신청자에게는 공개 댓글, IT팀 내부 논의에는 "내부 메모(🔒)" 토글을 켜고 작성합니다.' },
                { num: '4', title: '개발 착수 — 브랜치 생성', desc: 'GitLab에서 해당 Issue의 "Create branch" 버튼으로 feature 브랜치를 생성하고 개발을 시작합니다.' },
                { num: '5', title: '커밋 시 티켓 참조', desc: '커밋 메시지에 "#이슈번호" 또는 "Closes #N"을 포함하면 ITSM 티켓에 커밋 링크가 자동 기록됩니다.' },
                { num: '6', title: 'MR 생성 (feature → main)', desc: '개발 완료 후 GitLab에서 MR을 생성합니다. Assignee를 PL로 지정합니다.' },
              ],
              tip: '칸반에서 드래그가 안 되는 컬럼은 현재 상태에서 이동이 불가한 것입니다. 허용된 전환 규칙은 FAQ를 참고하세요.',
            },
            {
              role: '🗂️ PL',
              color: 'border-teal-300 dark:border-teal-700',
              headerBg: 'bg-teal-50 dark:bg-teal-900/20',
              steps: [
                { num: '1', title: '전체 티켓 현황 파악', desc: '티켓 목록에서 담당자·상태·기간 필터로 프로젝트 전체 현황을 파악합니다. 칸반 보드(g → k)에서 상태별 분포를 시각적으로 확인합니다.' },
                { num: '2', title: '개발 전달 (Issue 생성)', desc: '티켓 상세 우측 사이드바 "전달" 탭 → 대상 GitLab 프로젝트 선택 → 작업 내용 및 담당 개발자 지정 → "전달하기" 버튼 클릭합니다.' },
                { num: '3', title: '담당자 재배정', desc: '티켓 상세 → "담당자" 드롭다운에서 적절한 개발자를 선택합니다. 개발자 부재 또는 업무 과부하 시 조정합니다.' },
                { num: '4', title: '배포 태그 생성', desc: '개발기 배포: GitLab Tags → dev-YYYYMMDD 형식. 테스트기 배포: stg-YYYYMMDD 형식. 반드시 main 브랜치에서 생성합니다.' },
                { num: '5', title: 'MR 승인 (feature → main)', desc: '개발자가 생성한 MR을 코드 리뷰 후 Approve → Merge합니다. main 브랜치를 최신 상태로 유지합니다.' },
                { num: '6', title: 'release MR 생성 (main → release)', desc: '테스트가 완료되면 main → release 브랜치로 MR을 생성하고 IT팀에 승인을 요청합니다.' },
              ],
              tip: '"전달" 탭 드롭다운이 비어 있으면 GitLab 프로젝트 멤버 등록이 필요합니다. FAQ > "개발 프로젝트 전달 드롭다운에 프로젝트가 표시되지 않습니다"를 확인하세요.',
            },
            {
              role: '🎧 IT 담당자 (에이전트/관리자)',
              color: 'border-purple-300 dark:border-purple-700',
              headerBg: 'bg-purple-50 dark:bg-purple-900/20',
              steps: [
                { num: '1', title: '신규 접수 확인', desc: '홈 화면 "내 담당 티켓" 위젯 또는 헤더 알림(🔔)에서 새로 접수된 티켓을 확인합니다.' },
                { num: '2', title: '티켓 검토 및 승인', desc: '티켓 내용을 검토하고 담당자(PL 또는 개발자)를 배정합니다. 상태를 "승인완료"로 변경합니다.' },
                { num: '3', title: 'SLA 모니터링', desc: '티켓 목록에서 SLA 배지가 🟠/🔴인 티켓을 우선 처리합니다. 에스컬레이션 정책이 설정된 경우 자동으로 알림이 발송됩니다.' },
                { num: '4', title: '테스트중 상태로 전환', desc: 'PL이 테스트기 배포 완료를 알리면 티켓 상태를 "테스트중(testing)"으로 변경합니다. 현업 담당자에게 테스트 요청 알림이 자동 발송됩니다.' },
                { num: '5', title: '테스트 결과 확인 후 운영배포전 전환', desc: '현업 사용자가 테스트기에서 기능을 확인하고 댓글로 결과를 남기면 티켓 상태를 "운영배포전(ready_for_release)"으로 변경합니다. 추가 작업이 필요하면 "처리중"으로 되돌릴 수 있습니다.' },
                { num: '6', title: '운영 배포 승인', desc: 'GitLab CI/CD → release 브랜치 MR 승인 → v*.*.* 태그 생성 → Pipelines에서 deploy:production ▶ 수동 실행합니다.' },
                { num: '7', title: '리포트 확인', desc: 'g → r 단축키로 리포트 페이지에 이동합니다. 에이전트 성과·SLA 달성률·만족도 등을 주기적으로 확인합니다.' },
              ],
              tip: '일괄 작업(여러 티켓 동시 종료·배정·우선순위 변경)은 티켓 목록에서 체크박스로 선택 후 "일괄 작업" 버튼을 사용하세요.',
            },
            {
              role: '⚙️ 시스템관리자',
              color: 'border-red-300 dark:border-red-700',
              headerBg: 'bg-red-50 dark:bg-red-900/20',
              steps: [
                { num: '1', title: '사용자 역할 설정', desc: 'g → a 또는 헤더 "시스템 관리" 메뉴 → "사용자 관리" 탭에서 각 사용자의 역할을 user / developer / pl / agent / admin으로 지정합니다.' },
                { num: '2', title: 'SLA 정책 설정', desc: '"SLA 정책" 탭에서 우선순위별 응답·해결 목표 시간을 설정합니다. 저장 즉시 새 티켓에 적용됩니다.' },
                { num: '3', title: '서비스 유형 설정', desc: '"서비스 유형" 탭에서 현업이 선택할 카테고리(이모지·이름·하위 항목)를 추가합니다. GitLab 라벨이 자동 동기화됩니다.' },
                { num: '4', title: '에스컬레이션 정책 설정', desc: '"에스컬레이션 정책" 탭에서 SLA 임박/위반 시 자동 실행할 액션(알림·담당자 변경·우선순위 상향)을 구성합니다.' },
                { num: '5', title: '알림 채널 설정', desc: '"이메일 알림 연동" 탭에서 SMTP 설정을 완료합니다. Telegram 채널 알림은 환경변수 TELEGRAM_BOT_TOKEN으로 설정합니다.' },
                { num: '6', title: '감사 로그 확인', desc: '"감사 로그" 탭에서 주요 이벤트(역할 변경·일괄 작업·티켓 삭제 등)의 수행자·IP·시간을 정기적으로 검토합니다.' },
              ],
              tip: '민감한 관리 작업(역할 변경, 세션 강제 종료) 수행 전 Sudo 모드 재인증이 요구됩니다. GitLab 비밀번호로 재인증하면 15분 동안 유효합니다.',
            },
          ] as const).map((guide) => (
            <details key={guide.role} className={`bg-white dark:bg-gray-900 rounded-xl border-2 ${guide.color} shadow-sm overflow-hidden`}>
              <summary className={`flex items-center gap-3 px-5 py-4 cursor-pointer select-none ${guide.headerBg} hover:opacity-90 transition-opacity`}>
                <span className="font-semibold text-gray-800 dark:text-gray-100 flex-1">{guide.role}</span>
                <span className="text-gray-400 dark:text-gray-500 text-sm">▼ 펼치기</span>
              </summary>
              <div className="px-5 py-5">
                <div className="space-y-3 mb-4">
                  {guide.steps.map((s, i) => (
                    <div key={s.num} className="flex gap-3">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">{s.num}</div>
                        {i < guide.steps.length - 1 && <div className="w-0.5 flex-1 bg-blue-100 dark:bg-blue-900/30 my-1 min-h-[12px]" />}
                      </div>
                      <div className="flex-1 pb-1">
                        <p className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-0.5">{s.title}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                  <span className="text-blue-500 text-xs shrink-0 mt-0.5">💡 TIP</span>
                  <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">{guide.tip}</p>
                </div>
              </div>
            </details>
          ))}
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
            <div key={f.title} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-4 shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0">{f.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{f.title}</span>
                    {f.isNew && <NewBadge />}
                  </div>
                  <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">{f.note}</div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{f.desc}</p>
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
          <span className="text-xs text-gray-500 dark:text-gray-400">아래 보안 기능들은 시스템 수준에서 자동으로 동작하며 별도 설정 없이 활성화됩니다.</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SECURITY_FEATURES.map((f) => (
            <div key={f.title} className="bg-white dark:bg-gray-900 border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-400 transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0">{f.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{f.title}</span>
                    {f.isNew && <NewBadge />}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 모니터링 */}
      <section className="mb-10">
        <SectionTitle number="3" title="모니터링 (Prometheus + Grafana)" />
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <NewBadge />
            <span className="text-sm text-gray-600 dark:text-gray-400">Prometheus(:9090)와 Grafana(:3001)는 별도 profile 없이 항상 기동됩니다.</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: 'ITSM 운영 대시보드',
                icon: '📊',
                color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20',
                items: ['RED 메트릭 (Rate·Error·Duration)', '시스템 리소스 (CPU/메모리/디스크)', '요청 처리량 실시간 그래프', '에러율 추이'],
              },
              {
                title: 'ITSM 성능 분석',
                icon: '⚡',
                color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
                items: ['응답 레이턴시 퍼센타일 (p50/p95/p99)', '엔드포인트별 처리량 분석', '슬로우 쿼리 감지', 'API 병목 구간 시각화'],
              },
              {
                title: 'ITSM SLA 모니터링',
                icon: '🎯',
                color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20',
                items: ['서비스 가용성 (Availability)', 'Apdex 점수 (사용자 만족도 지수)', '에러 버짓 트래킹', 'SLA 위반 건수 추이'],
              },
              {
                title: 'ITSM 알림 & 인시던트',
                icon: '🔔',
                color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20',
                items: ['Firing/Pending/Critical 알림 수', '알림 목록 테이블 (심각도 컬러)', 'HTTP 5xx 오류율 타임시리즈', 'API 가용성 그래프'],
              },
            ].map((d) => (
              <div key={d.title} className={`border-2 rounded-xl p-4 ${d.color}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">{d.icon}</span>
                  <span className="font-bold text-sm text-gray-800 dark:text-gray-100">{d.title}</span>
                </div>
                <ul className="space-y-1">
                  {d.items.map((item) => (
                    <li key={item} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1">
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
          <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🔑</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">API 키 인증</span>
              <NewBadge />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">외부 시스템에서 ITSM API를 직접 호출할 때 사용합니다.</p>
            <div className="bg-gray-900 rounded-lg p-3 mb-3">
              <code className="text-xs text-green-400 font-mono">
                Authorization: Bearer itsm_live_xxxx
              </code>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <div><span className="font-medium">스코프:</span> tickets:read, tickets:write, kb:read, kb:write, webhooks:write</div>
              <div><span className="font-medium">관리:</span> /admin/api-keys</div>
              <div><span className="font-medium">보안:</span> SHA-256 해시 저장 (평문 미보관)</div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🔗</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">아웃바운드 웹훅</span>
              <NewBadge />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">ITSM 이벤트 발생 시 외부 서비스로 즉시 알림을 전송합니다.</p>
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6 space-y-5">

          {/* 개요 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
            담당자나 신청자가 아니어도 <strong>관심 있는 티켓의 진행 상황을 이메일로 추적</strong>할 수 있는 기능입니다.
            티켓 상세 화면 우측 사이드바 하단의 <strong>🔕 이 티켓 구독</strong> 버튼으로 등록·취소합니다.
          </div>

          {/* 사용 방법 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">사용 방법</h3>
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
                  <p className="text-sm text-gray-700 dark:text-gray-300 pt-0.5">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 알림 수신 상세 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">알림 수신 내역</h3>
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                    <th className="px-4 py-2.5 text-left">이벤트</th>
                    <th className="px-4 py-2.5 text-center">이메일 알림</th>
                    <th className="px-4 py-2.5 text-center">인앱(벨) 알림</th>
                    <th className="px-4 py-2.5 text-left">비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[
                    { event: '티켓 상태 변경', email: '✅', inapp: '❌', note: '접수됨→처리중→완료 등 모든 상태 전환' },
                    { event: '공개 댓글 등록', email: '✅', inapp: '❌', note: 'IT팀의 공개 답변' },
                    { event: '내부 메모(🔒) 등록', email: '❌', inapp: '❌', note: '비공개 메모는 구독자에게 전달 안 됨' },
                    { event: '담당자 변경', email: '❌', inapp: '❌', note: '담당자 본인에게만 별도 알림' },
                    { event: 'SLA 임박·위반 경고', email: '❌', inapp: '❌', note: '담당자·에이전트에게만 발송' },
                  ].map(row => (
                    <tr key={row.event} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 font-medium">{row.event}</td>
                      <td className="px-4 py-2.5 text-center text-base">{row.email}</td>
                      <td className="px-4 py-2.5 text-center text-base">{row.inapp}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 역할별 활용 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">역할별 활용 예시</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { role: '일반 사용자', emoji: '👤', bg: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700',
                  text: '내가 신청하지 않은 티켓이지만 관련 시스템 장애 현황을 추적하고 싶을 때' },
                { role: '개발자', emoji: '💻', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
                  text: '직접 담당은 아니지만 내가 관리하는 시스템 관련 티켓의 처리 경과를 확인하고 싶을 때' },
                { role: 'PL', emoji: '🗂️', bg: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800',
                  text: '프로젝트 내 전체 티켓 현황을 파악하고 개발자 배정 및 상태 변경을 직접 관리할 때' },
                { role: 'IT 에이전트', emoji: '🎧', bg: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
                  text: '중요 장애 티켓의 해결 과정을 동료가 처리하는 동안 함께 모니터링할 때' },
                { role: '팀장 / 관리자', emoji: '👔', bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
                  text: '우선순위 높은 티켓의 처리 결과를 별도 확인 없이 이메일로 받아보고 싶을 때' },
              ].map(item => (
                <div key={item.role} className={`rounded-xl border p-3.5 ${item.bg}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span>{item.emoji}</span>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{item.role}</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 제한 사항 */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">⚠️ 현재 제한 사항</h3>
            <ul className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1.5 leading-relaxed">
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6 space-y-5">

          {/* 개요 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
            티켓 상세 사이드바 <strong>"전달"</strong> 탭의 프로젝트 드롭다운에는{' '}
            <strong>현재 로그인한 사용자의 GitLab OAuth 토큰</strong>으로 조회한 결과가 채워집니다.
            서비스 계정(PRIVATE-TOKEN)이 아닌 <strong>개인 OAuth 토큰</strong>을 사용하므로,
            사용자마다 보이는 프로젝트 목록이 다릅니다.
          </div>

          {/* 표시 조건 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">표시 조건 (4가지 모두 충족해야 함)</h3>
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
                  <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{item.icon}</span>
                      <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{item.title}</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 동작 흐름 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">내부 동작 흐름</h3>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 font-mono text-xs text-gray-600 dark:text-gray-400 space-y-1 leading-relaxed">
              <div>사용자 로그인 → JWT에 <span className="text-blue-600">gitlab_token</span> (OAuth Access Token) 저장</div>
              <div className="pl-4 text-gray-400 dark:text-gray-500">↓</div>
              <div>티켓 상세 진입 → <span className="text-orange-600">GET /admin/dev-projects</span> 호출</div>
              <div className="pl-4 text-gray-400 dark:text-gray-500">↓</div>
              <div>GitLab API: <span className="text-purple-600">GET /api/v4/projects?membership=true&per_page=100</span></div>
              <div className="pl-4 text-gray-400 dark:text-gray-500">↓ (사용자 OAuth 토큰으로 조회)</div>
              <div>응답에서 <span className="text-red-500">GITLAB_PROJECT_ID</span> 제외 후 드롭다운에 표시</div>
            </div>
          </div>

          {/* 문제 해결 표 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">트러블슈팅</h3>
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700 text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-2.5 text-left font-semibold">증상</th>
                    <th className="px-4 py-2.5 text-left font-semibold">원인</th>
                    <th className="px-4 py-2.5 text-left font-semibold">해결 방법</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[
                    { symptom: '"전달" 탭 자체가 없음', cause: '역할이 user', fix: '관리자에게 developer 이상 역할 부여 요청' },
                    { symptom: '드롭다운이 비어 있음', cause: 'GitLab 프로젝트 멤버가 아님', fix: 'GitLab에서 해당 프로젝트에 멤버 추가' },
                    { symptom: '드롭다운이 비어 있음 (재로그인 후 해결)', cause: 'OAuth 토큰 만료', fix: '로그아웃 → 재로그인' },
                    { symptom: 'ITSM 프로젝트가 목록에 없음', cause: '정상 동작 (자동 제외)', fix: '조치 불필요' },
                    { symptom: '100개 이상 프로젝트 누락', cause: 'per_page=100 한도 초과', fix: '시스템관리자에게 문의' },
                    { symptom: '방금 멤버 추가했는데 안 뜸', cause: '기존 OAuth 토큰 캐시', fix: '로그아웃 → 재로그인으로 새 토큰 발급' },
                  ].map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{row.symptom}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{row.cause}</td>
                      <td className="px-4 py-2.5 text-blue-600 dark:text-blue-400 font-medium">{row.fix}</td>
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
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
                  <span className="text-gray-300 dark:text-gray-600 font-bold text-lg">→</span>
                )}
              </div>
            ))}
          </div>

          <div className="border-t dark:border-gray-700 pt-4">
            <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300 mb-3">주요 자동화 트리거</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { trigger: '대기중 전환', effect: 'SLA 타이머 자동 일시정지 (total_paused_seconds 누적)', icon: '⏸️' },
                { trigger: '대기중 → 다른 상태', effect: 'SLA 타이머 재개 (정지 시간 제외 계산)', icon: '▶️' },
                { trigger: 'GitLab MR 머지 (Closes #N)', effect: '티켓 자동 "처리완료" 전환 + 자동 코멘트', icon: '🔀' },
                { trigger: '종료 후 재오픈', effect: '"재개됨" 상태로 전환, SLA 재시작', icon: '🔄' },
              ].map((t) => (
                <div key={t.trigger} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                  <span className="text-lg shrink-0">{t.icon}</span>
                  <div>
                    <div className="font-semibold text-xs text-gray-700 dark:text-gray-300">{t.trigger}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.effect}</div>
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">우선순위</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">설명</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">최초 응답</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">해결 목표</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">예시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {SLA_ROWS.map((row) => (
                  <tr key={row.priority} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${row.color}`}>
                        {row.emoji} {row.priority}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600 dark:text-gray-400 text-xs">{row.desc}</td>
                    <td className="py-3 px-4 text-center font-bold text-gray-800 dark:text-gray-100">{row.response}h</td>
                    <td className="py-3 px-4 text-center font-bold text-gray-800 dark:text-gray-100">{row.resolve}h</td>
                    <td className="py-3 px-4 text-gray-500 dark:text-gray-400 text-xs">{row.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border-t dark:border-gray-700 text-xs text-blue-700 dark:text-blue-300">
            💡 SLA 목표 시간은 관리자 메뉴 → "SLA 정책" 탭에서 직접 수정할 수 있습니다. 변경 사항은 새로 등록되는 티켓부터 적용됩니다.
          </div>
        </div>
      </section>

      {/* SLA 에스컬레이션 */}
      <section className="mb-10">
        <SectionTitle number="3" title="SLA 에스컬레이션 자동화" />
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            SLA 체커 스레드(5분 주기)가 SLA 임박·위반 티켓을 감지하여 에스컬레이션 정책을 자동 실행합니다.
            EscalationRecord로 중복 실행을 방지합니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            {ESCALATION_ACTIONS.map((action) => (
              <div key={action.label} className="border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4">
                <div className="text-2xl mb-2">{action.icon}</div>
                <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-1">{action.label}</div>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{action.desc}</p>
              </div>
            ))}
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/50 border dark:border-gray-700 rounded-xl p-4">
            <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300 mb-3">정책 조합 예시</h4>
            <div className="space-y-2">
              {[
                { priority: '긴급', trigger: 'warning', delay: 0, action: '알림 발송', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
                { priority: '높음', trigger: 'breach', delay: 30, action: '담당자 변경', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
                { priority: '보통', trigger: 'breach', delay: 60, action: '우선순위 자동 상향', color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' },
              ].map((ex, i) => (
                <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                  <span className={`px-2 py-0.5 rounded font-bold ${ex.color}`}>{ex.priority}</span>
                  <span className="text-gray-500 dark:text-gray-400">+</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{ex.trigger}</span>
                  <span className="text-gray-500 dark:text-gray-400">+</span>
                  <span className="text-gray-600 dark:text-gray-400">지연 {ex.delay}분</span>
                  <span className="text-gray-400 dark:text-gray-500">→</span>
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { badge: '🟢 정상',   desc: 'SLA 기한까지 시간 여유 있음',          color: 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' },
              { badge: '🟡 주의',   desc: 'SLA 기한 1시간 이내 (사전 경고 알림)', color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700' },
              { badge: '🟠 임박',   desc: 'SLA 기한 30분 이내',                   color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700' },
              { badge: '🔴 위반',   desc: 'SLA 기한 초과됨',                      color: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700' },
            ].map((b) => (
              <div key={b.badge} className={`border-2 rounded-xl p-3 text-center ${b.color}`}>
                <div className="font-bold text-sm mb-1">{b.badge}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{b.desc}</div>
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 min-w-[220px]">기능</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 dark:text-gray-300 w-20">현업<br/>사용자</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 dark:text-gray-300 w-20">협력사<br/>개발자</th>
                  <th className="text-center py-3 px-3 font-semibold text-teal-700 dark:text-teal-300 w-20">협력사<br/>PL</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 dark:text-gray-300 w-20">IT<br/>에이전트</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700 dark:text-gray-300 w-20">IT<br/>관리자</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ROWS.map((row, i) => (
                  <tr key={row.feature} className={`border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-800/20'}`}>
                    <td className="py-2.5 px-4 text-gray-700 dark:text-gray-300 text-xs">
                      <span className="flex items-center gap-1.5">
                        {row.feature}
                        {row.isNew && <NewBadge />}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.user === '✅' ? 'text-green-600' : 'text-gray-300 dark:text-gray-600'}>{row.user}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.dev === '✅' ? 'text-green-600' : 'text-gray-300 dark:text-gray-600'}>{row.dev}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.pl === '✅' ? 'text-green-600' : 'text-gray-300 dark:text-gray-600'}>{row.pl}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.agent === '✅' ? 'text-green-600' : 'text-gray-300 dark:text-gray-600'}>{row.agent}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-sm font-medium">
                      <span className={row.admin === '✅' ? 'text-green-600' : 'text-gray-300 dark:text-gray-600'}>{row.admin}</span>
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
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          ✅ 기본 지원 · ⚠️ 제한적/설정 필요 · ❌ 미지원 · N/A 해당 없음
        </p>
        {COMPARISON_SECTIONS.map((section) => (
          <div key={section.category} className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden mb-4">
            <div className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700 px-4 py-2.5">
              <h3 className="font-bold text-sm text-gray-800 dark:text-gray-100">{section.category}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="text-left py-2 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 min-w-[200px]">기능</th>
                    <th className="text-center py-2 px-2 text-xs font-bold text-blue-700 dark:text-blue-400 w-16">ZENITH</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 dark:text-gray-400 w-16">Zammad</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 dark:text-gray-400 w-16">GLPI</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 dark:text-gray-400 w-16">Jira</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 dark:text-gray-400 w-20">Service Now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {section.rows.map((row) => (
                    <tr key={row.feature} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="py-2 px-4 text-xs text-gray-700 dark:text-gray-300">
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

/* ─── 탭: 업무 현황 & 성과 ───────────────────────────────────────────── */

function TabWorkloadPerf() {
  const GRADE_ROWS = [
    { grade: 'A', range: '85점 이상', color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700', desc: '탁월한 성과. SLA 달성률·완료율·고객 만족도 모두 우수' },
    { grade: 'B', range: '70 – 84점', color: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700',                   desc: '양호한 성과. 전반적으로 목표를 충족하고 있음' },
    { grade: 'C', range: '55 – 69점', color: 'text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700',       desc: '보통. 일부 지표에서 개선이 필요함' },
    { grade: 'D', range: '40 – 54점', color: 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700',       desc: '미흡. SLA 위반 또는 낮은 완료율에 주의 필요' },
    { grade: 'F', range: '40점 미만', color: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700',                         desc: '부진. 즉각적인 지원 및 원인 파악이 필요' },
  ]

  const METRIC_ROWS = [
    { col: '담당',      icon: '📋', desc: '현재 해당 사용자에게 배정된 전체 티켓 수 (기간 필터 적용 시 생성일 기준)', sort: true },
    { col: '백로그',    icon: '⏳', desc: '접수됨 + 처리중 티켓 수. 5건 초과 시 주황색으로 경고 표시', sort: true },
    { col: '완료',      icon: '✅', desc: '종료(closed) 처리된 티켓 수', sort: true },
    { col: '완료율',    icon: '📊', desc: '완료 ÷ 담당 × 100 (%). 담당 티켓 중 실제로 처리 완료한 비율', sort: true },
    { col: '처리시간',  icon: '⏱️', desc: '종료 티켓의 평균 처리 시간 (생성일 → 종료일). 분/시간/일 단위로 자동 변환', sort: true },
    { col: 'SLA 달성률', icon: '🎯', desc: 'DB의 SLA 기록 기준. SLA 준수 건수 ÷ 전체 SLA 측정 건수. 데이터 없으면 —', sort: false },
    { col: '고객평점',  icon: '⭐', desc: '종료 티켓에 대한 만족도 평가(1–5점) 평균. 별점 수(n건)와 함께 표시', sort: true },
    { col: '성과점수',  icon: '🏅', desc: 'SLA 달성률(40%) + 완료율(30%) + 고객평점(30%) 가중 합산. 데이터 부족 시 가용 지표로 정규화', sort: true },
    { col: '등급',      icon: '🏆', desc: '성과점수 기반 A/B/C/D/F 5단계 평가. 색상 배지로 시각화', sort: false },
  ]

  return (
    <div className="space-y-8">
      {/* 개요 */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">업무 현황 & 성과 <span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-2">Admin 전용 · /admin/workload</span></h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
          사용자별로 담당 티켓 수, 완료율, SLA 달성률, 고객 만족도를 종합해 성과를 평가하는 관리자 전용 페이지입니다.
          GitLab 이슈 데이터와 DB SLA·평가 기록을 결합하여 실시간 집계하며,
          상용 ITSM(Zendesk, Jira SM, Freshservice)의 에이전트 성과 리포트와 동일한 수준의 KPI를 제공합니다.
        </p>
      </section>

      {/* 접근 방법 */}
      <section className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">📍 접근 방법</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
          <span className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded px-2 py-0.5 font-mono">시스템 관리</span>
          <span>→</span>
          <span className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded px-2 py-0.5">리포트 그룹</span>
          <span>→</span>
          <span className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded px-2 py-0.5 font-semibold">📈 업무 현황 및 성과</span>
        </div>
        <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">Admin 역할만 접근 가능합니다. GitLab 이슈를 전수 조회하므로 첫 로딩에 수 초가 소요될 수 있습니다.</p>
      </section>

      {/* 화면 구성 */}
      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">화면 구성</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: '🔍', title: '필터 바', desc: '기간(from~to), 사용자명 드롭다운, 이름·아이디 텍스트 검색을 복합 적용할 수 있습니다. 기간 미선택 시 전체 티켓이 집계됩니다.' },
            { icon: '📊', title: 'KPI 카드 (5종)', desc: '전체 사용자 수 / 총 담당 티켓 / 총 완료 + 완료율 / 총 백로그 / 평균 SLA 달성률 + 고객 평점을 한눈에 확인합니다.' },
            { icon: '🏅', title: '등급 범례', desc: 'A–F 등급의 점수 기준과 계산 공식을 테이블 위에 항상 표시해 직관적으로 이해할 수 있습니다.' },
            { icon: '🥇', title: '상위 3인 포디엄', desc: '성과점수 기준 상위 3인을 금·은·동 카드로 하이라이트합니다. "포디엄 숨기기/보기" 버튼으로 토글 가능합니다.' },
            { icon: '📋', title: '성과 테이블', desc: '모든 사용자를 순위 포함 11컬럼으로 표시합니다. 컬럼 헤더 클릭 시 오름차순/내림차순 정렬이 가능합니다.' },
            { icon: '📥', title: 'CSV 내보내기', desc: '현재 필터·정렬이 적용된 데이터를 순위·성과점수·등급 포함 12개 컬럼으로 다운로드합니다. UTF-8 BOM 포함으로 Excel에서 바로 열 수 있습니다.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">{icon}</span>
                <div>
                  <p className="font-medium text-gray-800 dark:text-gray-100 text-sm">{title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 지표 설명 */}
      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">지표 설명</h3>
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase w-28">지표</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">설명</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase w-16">정렬</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {METRIC_ROWS.map(r => (
                <tr key={r.col} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">
                    <span className="mr-1">{r.icon}</span>{r.col}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs leading-relaxed">{r.desc}</td>
                  <td className="px-4 py-3 text-center text-xs">{r.sort ? '✅' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 성과 점수 계산식 */}
      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">성과 점수 계산식</h3>
        <div className="bg-gray-900 text-green-300 rounded-xl p-4 font-mono text-sm leading-relaxed">
          <p className="text-gray-400 dark:text-gray-500 text-xs mb-2">// 기본 계산 (모든 데이터가 있는 경우)</p>
          <p>score = SLA달성률 × <span className="text-yellow-300">0.40</span></p>
          <p>      + 완료율(closed/assigned×100) × <span className="text-yellow-300">0.30</span></p>
          <p>      + (고객평점/5×100) × <span className="text-yellow-300">0.30</span></p>
          <p className="mt-3 text-gray-400 dark:text-gray-500 text-xs">// 데이터 부족 시 — 가용 가중치 합으로 정규화</p>
          <p className="text-gray-300 dark:text-gray-600">if SLA기록 없음 → SLA 가중치(0.40) 제외 후 나머지로 정규화</p>
          <p className="text-gray-300 dark:text-gray-600">if 평가 없음   → 고객평점 가중치(0.30) 제외 후 나머지로 정규화</p>
          <p className="mt-3 text-gray-400 dark:text-gray-500 text-xs">// 예시: SLA 90%, 완료율 80%, 평점 4.0 → score = 90×0.4 + 80×0.3 + 80×0.3 = 84 → 등급 B</p>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          담당 티켓이 0건인 사용자는 성과점수와 등급이 표시되지 않습니다(—).
          완료율 지표는 항상 포함되므로 SLA·평점 데이터가 없어도 점수가 산출됩니다.
        </p>
      </section>

      {/* 등급 기준 */}
      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">성과 등급 기준</h3>
        <div className="grid gap-2 sm:grid-cols-5">
          {GRADE_ROWS.map(g => (
            <div key={g.grade} className={`border dark:border-gray-700 rounded-xl p-3 text-center ${g.color}`}>
              <div className={`text-2xl font-black`}>{g.grade}</div>
              <div className="text-xs font-semibold mt-1">{g.range}</div>
              <div className="text-xs mt-1 opacity-80 leading-tight">{g.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 필터 사용법 */}
      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">필터 활용법</h3>
        <div className="space-y-3">
          {[
            {
              title: '기간 필터',
              icon: '📅',
              desc: '시작일·종료일을 지정하면 해당 기간에 생성된 티켓만 집계합니다. 미선택 시 전체 이력이 대상입니다. SLA 달성률과 평점도 동일 기간으로 필터링됩니다.',
              tip: '월말 결산 시 "이번 달 1일 ~ 오늘"로 설정하면 월별 성과 리포트를 바로 확인할 수 있습니다.',
            },
            {
              title: '사용자명 드롭다운',
              icon: '👤',
              desc: '특정 사용자만 선택해 개인 성과를 집중적으로 확인합니다. 드롭다운에는 사용자 관리에 등록된 전체 사용자가 표시됩니다.',
              tip: '1:1 성과 면담 전 해당 직원의 기간별 데이터를 미리 확인하는 데 유용합니다.',
            },
            {
              title: '텍스트 검색',
              icon: '🔍',
              desc: '이름 또는 아이디(@username) 일부를 입력하면 실시간으로 테이블을 필터링합니다.',
              tip: '드롭다운과 텍스트 검색은 AND 조건으로 동작합니다.',
            },
          ].map(f => (
            <div key={f.title} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">{f.icon}</span>
                <div>
                  <p className="font-medium text-gray-800 dark:text-gray-100 text-sm">{f.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{f.desc}</p>
                  <div className="mt-2 flex items-start gap-1.5">
                    <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-medium shrink-0">TIP</span>
                    <p className="text-xs text-blue-600 dark:text-blue-300">{f.tip}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 활용 시나리오 */}
      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">활용 시나리오</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: '📆', title: '월별 성과 보고서', desc: '기간 필터를 이번 달로 설정 → CSV 내보내기 → 팀장 보고용 스프레드시트로 활용' },
            { icon: '⚠️', title: '백로그 과부하 감지', desc: '백로그 컬럼 내림차순 정렬 → 5건 이상(주황색) 표시 사용자 식별 → 업무 재배분' },
            { icon: '🎯', title: 'SLA 집중 관리', desc: 'SLA 달성률 오름차순 정렬 → 하위 사용자 파악 → SLA 정책 교육 또는 담당 건수 조정' },
            { icon: '⭐', title: '고객 만족도 관리', desc: '평점 오름차순 정렬 → 낮은 평점 원인 분석 → 빠른 답변 템플릿 보완 또는 응대 교육' },
            { icon: '📊', title: '성과 등급 분포 확인', desc: '등급 열 기준으로 A–F 분포를 파악해 팀 전체 역량 수준을 객관적으로 평가' },
            { icon: '🏆', title: '우수 사원 인정', desc: '포디엄 섹션에서 상위 3인을 즉시 확인 → 팀 미팅에서 공유하거나 인센티브 자료로 활용' },
          ].map(s => (
            <div key={s.title} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex gap-3 items-start">
              <span className="text-2xl shrink-0">{s.icon}</span>
              <div>
                <p className="font-medium text-gray-800 dark:text-gray-100 text-sm">{s.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 데이터 소스 */}
      <section className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 text-sm">데이터 소스 및 집계 방식</h3>
        <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
          {[
            { label: '사용자 목록',  src: 'ITSM DB · UserRole 테이블 (root 제외)',           note: '사용자 관리 화면과 동일 기준' },
            { label: '담당·완료',   src: 'GitLab API · 프로젝트 이슈 전수 조회',             note: '첫 번째 담당자(assignees[0]) 기준 집계' },
            { label: 'SLA 달성률', src: 'ITSM DB · SLARecord 테이블',                       note: 'SLA 위반 여부(breached) 컬럼 기반' },
            { label: '고객 평점',   src: 'ITSM DB · Rating 테이블',                         note: '종료 티켓에 대한 1–5점 평가' },
            { label: '처리 시간',   src: 'GitLab 이슈 created_at → closed_at 차이',          note: '종료된 이슈만 대상, 단위: 시간(h)' },
          ].map(d => (
            <div key={d.label} className="flex items-start gap-2">
              <span className="font-medium text-gray-700 dark:text-gray-300 w-20 shrink-0">{d.label}</span>
              <span className="text-gray-500 dark:text-gray-400">{d.src}</span>
              <span className="text-gray-400 dark:text-gray-500 ml-auto shrink-0 hidden sm:block">{d.note}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 border-t border-gray-200 dark:border-gray-700 pt-2">
          ※ 성과 점수·등급은 백엔드가 아닌 브라우저에서 실시간 계산됩니다. 데이터 집계 기준일은 API 호출 시점입니다.
        </p>
      </section>
    </div>
  )
}

/* ─── 탭: 성능 & 안정화 ──────────────────────────────────────────────── */

function TabPerf() {
  const SEVERITY_COLOR: Record<string, string> = {
    심각: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700',
    높음: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700',
    중간: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700',
    낮음: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700',
    정보: 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600',
  }
  return (
    <>
      {/* 성능 개선 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">1</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">성능 개선 — 티켓 목록 로드 최적화</h2>
        </div>
        <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-200">
          <span className="font-semibold">측정 기준:</span> 32개 이슈, 캐시 미스 환경 (GitLab CE 동일 호스트)
        </div>
        <div className="space-y-4">
          {PERF_IMPROVEMENTS.map((item) => (
            <div key={item.title} className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
              <div className="flex flex-wrap items-start gap-2 mb-3">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 border">{item.category}</span>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{item.title}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 text-xs">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <div className="text-red-600 dark:text-red-400 font-semibold mb-1">개선 전</div>
                  <div className="text-red-800 dark:text-red-200">{item.before}</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <div className="text-green-600 dark:text-green-400 font-semibold mb-1">개선 후</div>
                  <div className="text-green-800 dark:text-green-200">{item.after}</div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <div className="text-blue-600 dark:text-blue-400 font-semibold mb-1">효과</div>
                  <div className="text-blue-800 dark:text-blue-200 font-medium">{item.saving}</div>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 종합 성능 지표 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">2</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">종합 성능 지표</h2>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                <th className="px-4 py-2.5 text-left">지표</th>
                <th className="px-4 py-2.5 text-center">개선 전</th>
                <th className="px-4 py-2.5 text-center">개선 후</th>
                <th className="px-4 py-2.5 text-center">개선율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
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
                <tr key={row.metric} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{row.metric}</td>
                  <td className="px-4 py-2.5 text-center text-red-600 dark:text-red-400 font-mono text-xs">{row.before}</td>
                  <td className="px-4 py-2.5 text-center text-green-600 dark:text-green-400 font-mono text-xs">{row.after}</td>
                  <td className="px-4 py-2.5 text-center font-semibold text-blue-600 dark:text-blue-400 text-xs">{row.gain}</td>
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
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">안정화 수정 사항</h2>
        </div>
        <div className="space-y-4">
          {STABILITY_FIXES.map((item) => (
            <div key={item.title} className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xl">{item.emoji}</span>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm flex-1">{item.title}</h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${SEVERITY_COLOR[item.severity]}`}>{item.severity}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-gray-50 dark:bg-gray-800/50 border dark:border-gray-700 rounded-lg p-3">
                  <div className="text-gray-500 dark:text-gray-400 font-semibold mb-1">증상</div>
                  <div className="text-gray-700 dark:text-gray-300">{item.symptom}</div>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                  <div className="text-orange-600 dark:text-orange-400 font-semibold mb-1">원인</div>
                  <div className="text-orange-800 dark:text-orange-200">{item.cause}</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <div className="text-green-600 dark:text-green-400 font-semibold mb-1">수정</div>
                  <div className="text-green-800 dark:text-green-200">{item.fix}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Celery 비동기 태스크 큐 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">4</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Celery 비동기 태스크 큐 구축</h2>
        </div>

        {/* 개요 */}
        <div className="mb-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4 text-sm text-purple-800 dark:text-purple-200">
          이메일·Telegram·웹훅 알림을 HTTP 요청 흐름에서 분리하여 Celery Worker가 비동기로 처리합니다.
          브로커 장애 시 <code className="bg-purple-100 dark:bg-purple-800/50 px-1 rounded text-xs">BackgroundTasks</code> 직접 호출로 자동 fallback합니다.
        </div>

        {/* 아키텍처 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            {
              title: '태스크 목록 (app/tasks.py)',
              color: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20',
              items: [
                'send_notification — 범용 알림 (이메일·Telegram·웹훅)',
                'send_sla_warning — SLA 경고 (만료 N분 전)',
                'send_sla_breach — SLA 위반 (기간 초과)',
                'send_assigned_notification — 담당자 배정 알림',
              ],
            },
            {
              title: 'Fallback 전략',
              color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
              items: [
                'CELERY_BROKER_URL 미설정 → BackgroundTasks 직접 실행',
                'task.delay() 실패 → BackgroundTasks fallback',
                'SLA 알림: send_sla_warning.delay() → notify_sla_warning()',
                '담당자 알림: GitLab /users/{id} 이메일 조회 후 dispatch',
              ],
            },
            {
              title: '인프라 (docker-compose.yml)',
              color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20',
              items: [
                'celery-worker: --concurrency=4, healthcheck ping',
                'flower: mher/flower:2.0, 포트 5555 (localhost only)',
                'Redis 7.4-alpine 브로커 재사용',
                'Flower → celery-worker healthy 조건부 시작',
              ],
            },
          ].map((card) => (
            <div key={card.title} className={`border rounded-xl p-4 ${card.color}`}>
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-2">{card.title}</div>
              <ul className="space-y-1">
                {card.items.map((item) => (
                  <li key={item} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5">
                    <span className="text-gray-400 shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 테스트 결과 */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
            테스트 결과 (2026-03-20)
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/30 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                <th className="px-4 py-2 text-left">항목</th>
                <th className="px-4 py-2 text-center">결과</th>
                <th className="px-4 py-2 text-left">비고</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {[
                { item: 'pytest 전체 테스트', result: '✅ 1,713 passed', note: '0 failed · 902 warnings' },
                { item: '코드 커버리지', result: '✅ 97%', note: '10,058 statements (전체), 347 missed · --cov-fail-under=95 CI 강제' },
                { item: 'celery_app.py 임포트', result: '✅ 정상', note: 'Redis 브로커 연결 설정 포함' },
                { item: '_dispatch_notification 래퍼', result: '✅ 정상', note: 'delay() 실패 시 BackgroundTasks fallback' },
                { item: 'SLA warning 비동기화', result: '✅ 적용', note: 'sla.py → send_sla_warning.delay()' },
                { item: 'SLA breach 알림', result: '✅ 신규', note: 'check_and_flag_breaches 후 breach task dispatch' },
                { item: '담당자 배정 알림', result: '✅ 신규', note: 'get_user_email() → GitLab /users/{id}' },
                { item: 'Flower 모니터링', result: '✅ 추가', note: 'docker-compose.yml flower 서비스 (포트 5555)' },
              ].map((row) => (
                <tr key={row.item} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 text-sm">{row.item}</td>
                  <td className="px-4 py-2.5 text-center text-xs font-semibold text-green-600 dark:text-green-400">{row.result}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* OpenTelemetry 분산 추적 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">5</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">OpenTelemetry 분산 추적</h2>
        </div>
        <div className="mb-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 text-sm text-indigo-800 dark:text-indigo-200">
          <code className="bg-indigo-100 dark:bg-indigo-800/50 px-1 rounded text-xs">OTEL_ENABLED=true</code> 환경 변수로 활성화합니다.
          FastAPI 요청 추적과 SQLAlchemy 쿼리 추적을 OTLP gRPC로 내보냅니다.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: '설정 (app/telemetry.py)', color: 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20', items: ['OTEL_ENABLED=true 로 활성화', 'OTEL_EXPORTER_OTLP_ENDPOINT 지정', 'OTEL_SERVICE_NAME=itsm-api (기본값)', 'FastAPIInstrumentor + SQLAlchemyInstrumentor'] },
            { title: '계측 범위', color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20', items: ['모든 HTTP 요청 Span 자동 생성', 'SQLAlchemy 쿼리 commenter 활성화', 'BatchSpanProcessor로 비동기 내보내기', 'Resource에 service.name 태그 포함'] },
            { title: '패키지 미설치 시 동작', color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20', items: ['ImportError 발생 시 graceful skip', '운영 코드에 영향 없음 (선택적 활성화)', 'OTEL_ENABLED=false 기본값으로 개발 환경 호환', 'Jaeger / OTEL Collector 연동 가능'] },
          ].map((card) => (
            <div key={card.title} className={`border rounded-xl p-4 ${card.color}`}>
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-2">{card.title}</div>
              <ul className="space-y-1">{card.items.map((i) => <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5"><span className="text-gray-400 shrink-0">•</span><span>{i}</span></li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* DB 쿼리 N+1 감지 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">6</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">DB 쿼리 N+1 감지 및 최적화</h2>
        </div>
        <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-200">
          <code className="bg-amber-100 dark:bg-amber-800/50 px-1 rounded text-xs">app/db_profiler.py</code> — SQLAlchemy 이벤트 훅으로 느린 쿼리와 N+1 패턴을 실시간 감지합니다.
          개발 환경에서는 요청별 쿼리 횟수까지 추적합니다.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: '느린 쿼리 감지 (항상 활성)', color: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20', items: ['SLOW_QUERY_THRESHOLD_MS 환경변수로 임계값 조정 (기본 200ms)', '초과 쿼리: WARNING 로그 + SQL 스니펫 120자', 'production/development 모두 활성화', 'SQLAlchemy after_cursor_execute 이벤트 활용'] },
            { title: 'N+1 패턴 감지', color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20', items: ['같은 요청 내 동일 테이블 10회 이상 → WARNING', 'FROM 절 정규식으로 테이블명 추출', '개발 환경: 요청별 QueryProfilerMiddleware 활성화', '20회 초과 시 상위 5개 테이블 INFO 로그'] },
            { title: '적용 현황', color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20', items: ['main.py: setup_db_profiler(app, enabled=not is_production())', '개발환경: per-request N+1 추적 활성화', '운영환경: 느린 쿼리 감지만 활성화', 'ORM 조인 최적화 → selectinload/joinedload 적용'] },
          ].map((card) => (
            <div key={card.title} className={`border rounded-xl p-4 ${card.color}`}>
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-2">{card.title}</div>
              <ul className="space-y-1">{card.items.map((i) => <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5"><span className="text-gray-400 shrink-0">•</span><span>{i}</span></li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* 이메일 수신 자동 티켓 전환 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">7</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">이메일 수신 → 자동 티켓 전환</h2>
        </div>
        <div className="mb-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-xl p-4 text-sm text-teal-800 dark:text-teal-200">
          <code className="bg-teal-100 dark:bg-teal-800/50 px-1 rounded text-xs">app/email_ingest.py</code> — IMAP으로 미열람 이메일을 폴링해 GitLab 이슈(티켓)로 자동 전환합니다.
          답장 스레딩, 중복 방지, SLA 자동 생성, 배정 규칙 적용까지 완비됐습니다.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: '신규 티켓 처리', color: 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20', items: ['IMAP UNSEEN 폴링 (주기: IMAP_POLL_INTERVAL)', '이메일 → GitLab 이슈 자동 생성', 'HTML 태그 제거 + 최대 50,000자 제한', '배정 규칙 자동 적용 (evaluate_rules)', 'SLA 레코드 자동 생성', '접수 확인 이메일 발송'] },
            { title: '답장 스레딩', color: 'border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-900/20', items: ['In-Reply-To / References 헤더 → Redis 조회', '제목 [티켓 #N] 패턴 → GitLab 이슈 검증 후 연결', 'IID 스푸핑 방지: GitLab API로 실존 확인', '답장 → 기존 티켓에 노트(댓글) 추가', 'message_id → ticket_iid 30일 TTL 캐시'] },
            { title: '안정성·보안', color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20', items: ['Redis SET NX로 중복 이메일 방지', '사이클당 최대 50건 처리 (한도 초과 시 경고)', 'IMAP 연결 오류 → 재시도 다음 주기로 연기', 'PII 마스킹: 이메일 주소 로그 최소화', 'IMAP_ENABLED=false 기본값 (명시 활성화 필요)'] },
          ].map((card) => (
            <div key={card.title} className={`border rounded-xl p-4 ${card.color}`}>
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-2">{card.title}</div>
              <ul className="space-y-1">{card.items.map((i) => <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5"><span className="text-gray-400 shrink-0">•</span><span>{i}</span></li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* Alembic CI 자동화 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">8</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Alembic 마이그레이션 CI 자동화</h2>
        </div>
        <div className="mb-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4 text-sm text-violet-800 dark:text-violet-200">
          <code className="bg-violet-100 dark:bg-violet-800/50 px-1 rounded text-xs">migrate:check</code> CI 잡이 MR·main·release 브랜치마다 PostgreSQL 컨테이너에 모든 마이그레이션을 적용하고
          미반영 파일 0건을 검증합니다. pytest는 SQLite를 사용하므로 이 잡이 실제 DB 호환성을 보장합니다.
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden mb-4">
          <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
            CI 파이프라인 잡 (migrate:check)
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 dark:bg-gray-800/30 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400"><th className="px-4 py-2 text-left">항목</th><th className="px-4 py-2 text-left">내용</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {[
                { k: 'stage', v: 'test (lint:backend 완료 후 실행)' },
                { k: '서비스', v: 'postgres:16-alpine (CI 서비스 컨테이너)' },
                { k: '실행 명령', v: 'alembic upgrade head → alembic check' },
                { k: '트리거', v: 'MR 생성·업데이트, main, release 브랜치 push' },
                { k: '마이그레이션 파일', v: '0001 ~ 0052 (52단계)' },
                { k: '실패 시', v: 'allow_failure: false — 파이프라인 차단' },
              ].map((r) => (
                <tr key={r.k} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500 dark:text-gray-400 w-40">{r.k}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{r.v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 데이터 내보내기·가져오기 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">9</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">데이터 내보내기·가져오기</h2>
        </div>
        <div className="mb-4 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-xl p-4 text-sm text-sky-800 dark:text-sky-200">
          관리자가 배정 규칙·SLA 정책·빠른 답변·공지사항·에스컬레이션 정책을 JSON/CSV로 내보내고,
          JSON 파일로 되가져올 수 있습니다. <code className="bg-sky-100 dark:bg-sky-800/50 px-1 rounded text-xs">mode=replace</code>로 전체 교체도 지원합니다.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { title: 'GET /admin/export/{target}', color: 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20', items: ['target: assignment-rules | sla-policies | quick-replies | announcements | escalation-policies', 'fmt=json (기본) 또는 fmt=csv', 'JSON: {target, exported_at, count, data[]} 구조', 'CSV: UTF-8 BOM, Content-Disposition 다운로드', '관리자 권한 필요'] },
            { title: 'POST /admin/import/{target}', color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20', items: ['multipart/form-data — JSON 파일 업로드', 'mode=append: 기존 유지 + 새 항목 추가 (기본)', 'mode=replace: 기존 전체 삭제 후 교체', '파일 크기 제한: 최대 10 MB', 'id·created_at 등 읽기 전용 필드 자동 무시', 'created_by: 현재 관리자 계정으로 자동 설정'] },
          ].map((card) => (
            <div key={card.title} className={`border rounded-xl p-4 ${card.color}`}>
              <div className="font-semibold text-sm font-mono text-gray-800 dark:text-gray-100 mb-2">{card.title}</div>
              <ul className="space-y-1">{card.items.map((i) => <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5"><span className="text-gray-400 shrink-0">•</span><span>{i}</span></li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* API v1 버전 관리 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">10</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">API v1 버전 관리 (/api/v1 프리픽스)</h2>
        </div>
        <div className="mb-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl p-4 text-sm text-rose-800 dark:text-rose-200">
          모든 라우터를 <code className="bg-rose-100 dark:bg-rose-800/50 px-1 rounded text-xs">_v1 = APIRouter()</code>로 집약한 뒤
          <code className="bg-rose-100 dark:bg-rose-800/50 px-1 rounded text-xs">/api/v1/...</code>와 <code className="bg-rose-100 dark:bg-rose-800/50 px-1 rounded text-xs">/...</code> 두 경로에 동시 마운트합니다. 레거시 클라이언트 하위 호환을 유지하면서 신규 클라이언트는 /api/v1 사용을 권장합니다.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: '경로 구조 (main.py)', color: 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20', items: ['_v1 = APIRouter() — 전체 라우터 집약점', 'app.include_router(_v1, prefix="/api/v1") — 버전 경로', 'app.include_router(_v1) — 레거시 경로 (하위 호환)', '향후 /api/v2 추가 시 _v1 유지·병행 운영 가능'] },
            { title: '마운트된 라우터 (20개)', color: 'border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-900/20', items: ['auth, tickets, ratings, projects (core)', 'admin, webhooks, kb, reports (enterprise)', 'notifications, templates, forwards, filters', 'portal, quick_replies, watchers, automation', 'approvals, ticket_types, service_catalog, dashboard, ip_allowlist, faq'] },
            { title: '호환성 전략', color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20', items: ['현재: /tickets/ = /api/v1/tickets/ (동일 응답)', '프론트엔드: 레거시 경로 유지 (즉시 변경 불필요)', '신규 통합: /api/v1/... 사용 권장', 'deprecated 예고 후 레거시 경로 제거 예정'] },
          ].map((card) => (
            <div key={card.title} className={`border rounded-xl p-4 ${card.color}`}>
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-2">{card.title}</div>
              <ul className="space-y-1">{card.items.map((i) => <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5"><span className="text-gray-400 shrink-0">•</span><span>{i}</span></li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* Playwright E2E 테스트 */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">11</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Playwright E2E 테스트 기본 설정</h2>
        </div>
        <div className="mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-sm text-emerald-800 dark:text-emerald-200">
          <code className="bg-emerald-100 dark:bg-emerald-800/50 px-1 rounded text-xs">itsm-web/e2e/</code> 디렉토리에 Playwright E2E 테스트가 구성됩니다.
          <code className="bg-emerald-100 dark:bg-emerald-800/50 px-1 rounded text-xs">npm run test:e2e</code>로 실행하며 로컬에서는 Next.js 개발 서버를 자동 시작합니다.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: '테스트 파일 구조 (11개 스펙)', color: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20', items: ['auth.setup.ts — 관리자 로그인·쿠키 저장', 'tickets.spec.ts — 티켓 목록·생성·검색 E2E', 'ticket-flow.spec.ts — 티켓 전체 플로우 (생성→목록→상세→댓글)', 'comment-flow.spec.ts — 댓글 입력·제출·내부메모 플로우', 'mobile.spec.ts — 모바일 뷰포트 반응형 UI 검증 (Pixel 7)', 'a11y.spec.ts — WCAG 2.1 AA 접근성 자동 감사 (axe-playwright)', 'admin.spec.ts — 관리자 패널·접근성 검사', 'portal.spec.ts — 고객 포털 티켓 제출 플로우', 'automation.spec.ts — 자동화 규칙 관리·API', 'kb.spec.ts — 지식베이스 목록·상세·작성', 'notifications.spec.ts — 알림·SSE 스트림·배지'] },
            { title: '인증 전략 (JWT + Redis)', color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20', items: ['토큰 생성: create_token() + store_gitlab_token(jti)', 'E2E_ADMIN_TOKEN 환경변수 → 쿠키 직접 주입 (CI)', 'GitLab OAuth 버튼 클릭 → 인터랙티브 로그인 (로컬)', 'storageState: e2e/.auth/admin.json 재사용', '포털 테스트: 인증 없이 독립 실행 (portal 프로젝트)'] },
            { title: 'CI 통합 (.github/workflows/e2e.yml)', color: 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20', items: ['E2E_BASE_URL: http://localhost:3000 (CI 내부)', 'JWT 토큰 자동 생성 + Redis JTI 등록 (CI 단계)', 'Next.js 서버 준비 대기 (curl 헬스체크 루프)', 'retries: 2 (CI 환경 flaky 대응)', 'screenshot/video: 실패 시 Artifact 14일 저장'] },
          ].map((card) => (
            <div key={card.title} className={`border rounded-xl p-4 ${card.color}`}>
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-2">{card.title}</div>
              <ul className="space-y-1">{card.items.map((i) => <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5"><span className="text-gray-400 shrink-0">•</span><span>{i}</span></li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* 안정화 체크 결과 */}
      <section className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">12</div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">현재 시스템 상태</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { emoji: '✅', label: '모든 컨테이너', desc: '11개 Up (재시작 0회)' },
            { emoji: '✅', label: 'API 헬스체크', desc: 'DB·Redis·GitLab·label_sync all ok' },
            { emoji: '✅', label: 'Python 모듈', desc: '30개 정상 로드' },
            { emoji: '✅', label: 'TypeScript 타입', desc: '오류 없음' },
            { emoji: '✅', label: 'DB 마이그레이션', desc: '0052 (최신) · CI alembic check 통과' },
            { emoji: '✅', label: 'DB 제약조건', desc: '비정상 0건' },
            { emoji: '✅', label: 'Prometheus 스크레이프', desc: 'itsm-api: up' },
            { emoji: '✅', label: 'Grafana 대시보드', desc: '5개 자동 프로비저닝 (알림 대시보드 포함)' },
            { emoji: '✅', label: 'Celery Worker', desc: '--concurrency=4, healthcheck ping' },
            { emoji: '✅', label: 'Flower 모니터링', desc: 'mher/flower:2.0 (포트 5555)' },
            { emoji: '✅', label: '보안 헤더 7종', desc: 'CSP·HSTS·X-Frame 등' },
            { emoji: '✅', label: 'npm 취약점', desc: 'high/critical 없음 (low 4건)' },
            { emoji: '✅', label: '비즈니스 메트릭', desc: '27개 샘플 수집 중' },
            { emoji: '✅', label: '테스트 커버리지', desc: '97%+ (pytest 1,713 · CI --cov-fail-under=95 강제)' },
            { emoji: '⚠️', label: 'SECRET_KEY', desc: '운영 배포 전 반드시 교체 필요' },
          ].map((item) => (
            <div key={item.label} className={`flex items-start gap-3 rounded-lg border p-3 ${item.emoji === '⚠️' ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
              <span className="text-lg shrink-0">{item.emoji}</span>
              <div>
                <div className="font-semibold text-sm text-gray-800 dark:text-gray-100">{item.label}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 서버 이전 스크립트 */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">🚚 서버 이전 스크립트</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">scripts/</code> 디렉토리에 무중단 서버 이전을 위한 4개 스크립트가 포함되어 있습니다.
          모든 스크립트는 <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">--dry-run</code> 옵션으로 실제 명령 없이 실행 계획을 먼저 확인할 수 있습니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              name: 'migrate_backup.sh',
              desc: '구 서버에서 실행. nginx 점검 모드 전환 → PostgreSQL 최종 덤프(custom format, MD5 체크섬 생성) → Redis 스냅샷 → 업로드 파일 동기화 → 신규 서버로 rsync 전송.',
              usage: './scripts/migrate_backup.sh [--output-dir DIR] [--new-server user@host]',
            },
            {
              name: 'migrate_restore.sh',
              desc: '신규 서버에서 실행. MD5 무결성 검증 → postgres/redis 기동 → pg_restore DB 복원 → Alembic 마이그레이션 → 전체 서비스 기동 → 데이터 정합성 검증 → API 헬스체크.',
              usage: './scripts/migrate_restore.sh [--uploads-dir DIR] <dump.dump>',
            },
            {
              name: 'migrate_verify.sh',
              desc: '구·신 서버의 레코드 수(티켓·댓글·SLA·사용자·KB·감사 로그)를 비교하여 데이터 정합성을 검증합니다. 차이가 10% 이상이면 경고를 출력합니다.',
              usage: './scripts/migrate_verify.sh --old-server OLD_DB_URL --new-server NEW_DB_URL',
            },
            {
              name: 'migrate_rollback.sh',
              desc: '긴급 롤백 시 사용. --dump-delta로 신규 서버 데이터 보존 → --block으로 신규 서버 nginx 점검 모드 전환 → 구 서버에서 --restore-old로 nginx 정상 복원.',
              usage: './scripts/migrate_rollback.sh --block | --restore-old | --dump-delta',
            },
          ].map((s) => (
            <div key={s.name} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="font-semibold text-sm text-blue-700 dark:text-blue-400 mb-1">{s.name}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">{s.desc}</div>
              <code className="block text-xs bg-gray-100 dark:bg-gray-900 rounded px-2 py-1 text-gray-700 dark:text-gray-300 break-all">{s.usage}</code>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          롤백 기준: GitLab OAuth 로그인 전체 실패(5분 이상) · DB 데이터 유실 · API 에러율 &gt;10%(5분 기준) · 파일 업로드/다운로드 전체 실패
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
            { name: 'Python',      version: '3.13',    emoji: '🐍', color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200' },
            { name: 'Next.js',     version: '15.5.x',  emoji: '⚛️', color: 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-100' },
            { name: 'Node.js',     version: '22',      emoji: '🟢', color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' },
            { name: 'PostgreSQL',  version: '17',      emoji: '🐘', color: 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-200' },
            { name: 'Redis',       version: '7.4',     emoji: '🔴', color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200' },
            { name: 'Nginx',       version: '1.27',    emoji: '🔀', color: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' },
            { name: 'Alembic',     version: '52단계',  emoji: '📋', color: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200' },
            { name: 'Prometheus',  version: 'latest',  emoji: '📊', color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200' },
            { name: 'Grafana',     version: 'latest',  emoji: '📈', color: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200' },
            { name: 'ClamAV',      version: 'latest',  emoji: '🦠', color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200' },
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
                    <span className="font-bold text-gray-800 dark:text-gray-100">{comp.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${comp.badge}`}>{comp.category}</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{comp.version}</div>
                </div>
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 hidden md:block">{comp.role}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 px-5 py-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 leading-relaxed">{comp.desc}</p>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {comp.details.map((d) => (
                    <li key={d} className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700">
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 dark:text-gray-400">발신</th>
                  <th className="text-center py-2.5 px-3 font-semibold text-gray-600 dark:text-gray-400 w-8"></th>
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 dark:text-gray-400">수신</th>
                  <th className="text-center py-2.5 px-3 font-semibold text-gray-600 dark:text-gray-400">프로토콜</th>
                  <th className="text-center py-2.5 px-3 font-semibold text-gray-600 dark:text-gray-400">포트</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">설명</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {CONNECTIONS.map((c, i) => (
                  <tr key={i} className={c.color}>
                    <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-300">{c.from}</td>
                    <td className="py-2 px-3 text-center text-gray-400 dark:text-gray-500 font-bold">{c.direction}</td>
                    <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-300">{c.to}</td>
                    <td className="py-2 px-3 text-center">
                      <span className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-400 font-mono">{c.protocol}</span>
                    </td>
                    <td className="py-2 px-3 text-center font-mono text-gray-500 dark:text-gray-400">{c.port}</td>
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{c.detail}</td>
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
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
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
              { key: 'SLACK_ENABLED', default: 'false', desc: 'Slack 알림 활성화 (true/false)' },
              { key: 'SLACK_WEBHOOK_URL', default: '—', desc: 'Slack Incoming Webhook URL (https://hooks.slack.com/...)' },
              { key: 'SLACK_CHANNEL', default: '—', desc: 'Slack 기본 알림 채널 (예: #itsm-alerts), 비어 있으면 웹훅 기본 채널 사용' },
            ].map((env) => (
              <div key={env.key} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-start gap-3">
                <code className="text-xs font-mono bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-blue-700 dark:text-blue-300 shrink-0">{env.key}</code>
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">{env.desc}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">기본값: {env.default}</div>
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
      <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">📖</span>
          <div>
            <div className="font-semibold text-blue-800 dark:text-blue-200 text-sm mb-1">전체 API 명세 (Swagger)</div>
            <p className="text-xs text-blue-600 dark:text-blue-300 mb-2">
              Swagger UI(<Link href="http://localhost:8111/docs" target="_blank" rel="noopener noreferrer" className="underline">http://localhost:8111/docs</Link>)에서
              모든 엔드포인트를 직접 테스트할 수 있습니다. 인증이 필요한 엔드포인트는 로그인 후 쿠키가 자동 포함됩니다.
            </p>
            <div className="text-xs text-blue-700 dark:text-blue-300">
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
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{group.endpoints.length}개 엔드포인트</span>
                </div>
                <span className="text-gray-400 dark:text-gray-500 text-lg">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-700">
                  {group.endpoints.map((ep) => (
                    <div key={`${ep.method}-${ep.path}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <MethodBadge method={ep.method} />
                      <code className="text-xs font-mono text-gray-600 dark:text-gray-400 flex-1 min-w-0 truncate">{ep.path}</code>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {ep.isNew && <NewBadge />}
                        <span className="text-xs text-gray-500 dark:text-gray-400 hidden md:block max-w-xs truncate">{ep.desc}</span>
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
          <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
            <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 mb-2">🍪 JWT 쿠키 (웹 로그인)</div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">GitLab OAuth 로그인 후 itsm_token 쿠키가 자동 설정됩니다. 브라우저 요청에 자동 포함되며 2시간마다 Refresh Token으로 갱신됩니다.</p>
            <div className="bg-gray-900 rounded-lg p-2">
              <code className="text-xs text-green-400 font-mono">Cookie: itsm_token=eyJ...</code>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">🔑 API 키 (외부 시스템)</span>
              <NewBadge />
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">관리자가 발급한 API 키를 Bearer 토큰으로 사용합니다. 스코프 기반 권한 제어 및 SHA-256 해시 저장.</p>
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
    color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200',
    badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    itsmRole: 'user',
    actions: ['요청 등록', '테스트 수행', '최종 완료 처리'],
    screens: ['포털 (/portal)', '티켓 상세'],
  },
  {
    role: 'IT팀',
    color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-200',
    badge: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    itsmRole: 'agent / admin',
    actions: ['요청 승인 (담당자 배정)', '테스트 완료 전달', '운영 배포 승인 (GitLab MR)', '최종 확인'],
    screens: ['티켓 목록', '티켓 상세', 'GitLab MR'],
  },
  {
    role: 'PL',
    color: 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 dark:border-teal-700 text-teal-800 dark:text-teal-200',
    badge: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
    itsmRole: 'pl',
    actions: ['Issue 생성 (개발 전달)', 'feature 브랜치 생성', 'MR 승인 (main)', '개발기/테스트기 태그 생성', 'release MR 생성'],
    screens: ['티켓 상세 → 개발 전달', 'GitLab 직접'],
  },
  {
    role: '개발자',
    color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-800 dark:text-orange-200',
    badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    itsmRole: 'developer',
    actions: ['기능 개발', '로컬 검증', 'MR 생성 (main)'],
    screens: ['티켓 목록 (본인 할당분)', 'GitLab 직접'],
  },
  {
    role: 'GitLab 시스템',
    color: 'bg-gray-50 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300',
    badge: 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400',
    itsmRole: '—',
    actions: ['브랜치 생성', '빌드/테스트 자동화', '서버 배포 (CI/CD)', 'ITSM 웹훅 이벤트 전달'],
    screens: ['GitLab CI/CD 파이프라인'],
  },
]

const TERM_MAP = [
  { term: 'Epic (상위 단위, 현업 요청)', itsm: 'ITSM 티켓', note: 'GitLab ITSM 프로젝트 Issue', color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
  { term: 'Issue (하위 단위, 개발 작업)', itsm: '개발 전달 이슈', note: 'GitLab 개발 프로젝트 Issue (개발 전달 기능)', color: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800' },
  { term: 'Epic: open',              itsm: '티켓 상태 · 접수됨',       note: 'status::open',              color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' },
  { term: 'Epic: approved',          itsm: '티켓 상태 · 승인완료',     note: 'status::approved',          color: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800' },
  { term: 'Epic: in-progress',       itsm: '티켓 상태 · 처리중',       note: 'status::in_progress',       color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
  { term: 'Epic: testing',           itsm: '티켓 상태 · 테스트중',     note: 'status::testing (별도 테스트 전용 상태)', color: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700' },
  { term: 'Epic: resolved',          itsm: '티켓 상태 · 처리완료',     note: 'status::resolved',          color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' },
  { term: 'Epic: ready-for-release', itsm: '티켓 상태 · 운영배포전',   note: 'status::ready_for_release', color: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' },
  { term: 'Epic: released',          itsm: '티켓 상태 · 운영반영완료', note: 'status::released',          color: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-700' },
  { term: 'Epic: done',              itsm: '티켓 Closed',              note: 'GitLab issue closed',       color: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' },
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
    id: '3-1',
    phase: '3.1',
    title: '요청 등록 및 승인',
    actor: '현업 → IT팀 → PL',
    actorColor: 'text-blue-700',
    steps: [
      { who: '현업', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200', action: '요청 등록', detail: '포털(/) 또는 티켓 등록에서 서비스 유형·제목·내용·우선순위 입력 후 제출 → 티켓 생성 (상태: 접수됨/open)' },
      { who: 'IT팀', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200', action: '검토 및 승인', detail: '티켓 상세 → 댓글로 승인 의사 기록 → 담당자(PL) 배정 → 상태를 승인완료로 변경 (이후 PL이 처리중으로 전환)', code: '티켓 담당자 드롭다운 → PL 선택 → 상태 "승인완료(approved)"로 변경' },
      { who: 'PL', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200', action: '개발 전달 (Issue 생성)', detail: '티켓 상세 → 사이드바 "전달" 탭 → 대상 개발 프로젝트 선택 → 작업 내용·담당자 입력 → 전달', code: '티켓 상세 우측 → 개발 전달 탭 → "전달하기" 버튼' },
      { who: 'GitLab', color: 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300', action: 'feature 브랜치 생성', detail: 'GitLab 개발 프로젝트 → Issues → 해당 Issue → "Create branch" 버튼 → feature/이슈번호-설명 형식', code: 'GitLab > Issues > Create branch' },
    ],
  },
  {
    id: '3-2',
    phase: '3.2',
    title: '기능 개발 및 로컬 검증',
    actor: '개발자',
    actorColor: 'text-orange-700',
    gitlabDirect: true,
    steps: [
      { who: '개발자', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200', action: 'feature 브랜치 checkout', detail: '로컬에서 feature 브랜치를 내려받아 개발 시작', code: 'git checkout feature/이슈번호-설명' },
      { who: '개발자', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200', action: '기능 개발 및 커밋', detail: '기능 개발 완료 후 커밋 메시지에 이슈 번호 포함 → ITSM 자동 참조 댓글 등록', code: 'git commit -m "feat: 기능 설명 (#이슈번호)"\ngit push origin feature/이슈번호-설명' },
    ],
    note: '커밋 메시지에 "#이슈번호" 포함 시 ITSM 티켓에 커밋 링크가 자동 기록됩니다.',
  },
  {
    id: '3-3',
    phase: '3.3',
    title: 'main 반영 (MR 생성 → 승인 → 병합)',
    actor: '개발자 → PL → GitLab',
    actorColor: 'text-orange-700',
    gitlabDirect: true,
    steps: [
      { who: '개발자', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200', action: 'MR 생성 (feature → main)', detail: 'GitLab → Merge Requests → New → source: feature/... → target: main → Assignee: PL', code: 'GitLab > MR > New MR\nsource: feature/... → target: main' },
      { who: 'GitLab', color: 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300', action: 'CI 자동 실행', detail: 'MR 생성 트리거 → lint + test 파이프라인 자동 실행', code: '.gitlab-ci.yml → rules-lint-test' },
      { who: 'PL', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200', action: 'MR 코드 리뷰 및 승인·병합', detail: 'GitLab → MR 상세 → 코드 리뷰 → "Approve" → "Merge" → feature 브랜치 자동 삭제', code: 'GitLab MR > Approve > Merge' },
      { who: 'GitLab → ITSM', color: 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300', action: 'Issue 자동 Closed', detail: 'MR 병합 → 웹훅 이벤트 → ITSM 개발 전달 이슈 상태 자동 업데이트 (MR 설명에 "Closes #N" 포함 시 티켓도 resolved 자동 전환)', code: 'MR 설명: "Closes #N" → 티켓 자동 resolved' },
    ],
  },
  {
    id: '3-4',
    phase: '3.4',
    title: '개발기 배포 및 확인',
    actor: 'PL',
    actorColor: 'text-teal-700',
    gitlabDirect: true,
    steps: [
      { who: 'PL', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200', action: '개발기 배포 태그 생성', detail: 'GitLab → 개발 프로젝트 → Repository → Tags → New tag → dev-YYYYMMDD → Create from: main', code: 'Tag name: dev-20260313\nCreate from: main 브랜치' },
      { who: 'GitLab', color: 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300', action: '개발기 자동 배포', detail: 'dev-* 태그 트리거 → build:api + build:web → deploy:dev → healthcheck 자동 실행', code: 'CI/CD: deploy:dev 자동 실행' },
      { who: 'PL', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200', action: 'ITSM 확인 기록', detail: 'ITSM 티켓 → 댓글: "개발기 배포 완료. 확인 요청드립니다."', code: '티켓 댓글 등록' },
    ],
  },
  {
    id: '3-5',
    phase: '3.5',
    title: '테스트기 배포 및 테스트',
    actor: 'PL → IT팀 → 현업',
    actorColor: 'text-teal-700',
    gitlabDirect: true,
    steps: [
      { who: 'PL', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200', action: '테스트기 배포 태그 생성', detail: 'GitLab → Tags → New tag → stg-YYYYMMDD → Create from: main', code: 'Tag name: stg-20260313\nCreate from: main 브랜치' },
      { who: 'GitLab', color: 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300', action: '테스트기 자동 배포', detail: 'stg-* 태그 트리거 → build → deploy:staging → healthcheck 자동 실행', code: 'CI/CD: deploy:staging 자동 실행' },
      { who: 'IT팀', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200', action: '현업에 테스트 요청', detail: 'ITSM 티켓 → 댓글로 안내 → 상태를 "테스트중(testing)"으로 변경. 추가 정보가 필요하면 "대기중(waiting)"으로 변경 (SLA 자동 일시정지)', code: '상태 → 테스트중(testing)으로 변경\n(추가정보 대기 시 → 대기중(waiting))' },
      { who: '현업', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200', action: '테스트기에서 테스트 수행', detail: 'ITSM 포털 → 내 요청 → 해당 티켓 → 테스트 후 댓글로 결과 전달', code: '티켓 댓글: "테스트 완료 확인했습니다."' },
      { who: 'IT팀', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200', action: '테스트 확인 완료 처리', detail: 'ITSM 티켓 → 상태를 "운영배포전(ready_for_release)"으로 변경 (운영 배포 준비 완료 신호)', code: '상태 → 운영배포전(ready_for_release)으로 변경' },
    ],
  },
  {
    id: '3-6',
    phase: '3.6',
    title: 'release 반영 (운영 브랜치)',
    actor: 'PL → IT팀',
    actorColor: 'text-teal-700',
    gitlabDirect: true,
    steps: [
      { who: 'PL', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200', action: 'MR 생성 (main → release)', detail: 'GitLab → Merge Requests → New → source: main → target: release → Assignee: IT팀', code: 'GitLab > MR > New\nsource: main → target: release' },
      { who: 'GitLab', color: 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300', action: 'CI 자동 실행', detail: 'release 브랜치 대상 lint + test 파이프라인 자동 실행', code: 'CI/CD: lint + test 자동 실행' },
      { who: 'IT팀', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200', action: 'release MR 승인·병합', detail: 'GitLab → MR 상세 → 코드 리뷰 → "Approve" → "Merge" → release 브랜치에 main 병합 완료', code: 'GitLab MR > Approve > Merge' },
    ],
  },
  {
    id: '3-7',
    phase: '3.7',
    title: '운영 배포 및 종료',
    actor: 'IT팀 → 현업',
    actorColor: 'text-purple-700',
    gitlabDirect: true,
    steps: [
      { who: 'IT팀', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200', action: '운영 배포 태그 생성', detail: 'GitLab → release 브랜치 → Tags → New tag → v1.2.3 형식으로 생성', code: 'Tag name: v0.1.0\nCreate from: release 브랜치' },
      { who: 'GitLab', color: 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300', action: 'CI: deploy:production 대기', detail: 'v*.*.* 태그 트리거 → build 완료 → deploy:production 잡이 수동(manual) 상태로 대기', code: 'CI/CD > Pipelines > deploy:production ▶ 클릭' },
      { who: 'IT팀', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200', action: '운영 배포 수동 승인', detail: 'GitLab → CI/CD → Pipelines → 해당 파이프라인 → deploy:production → ▶ 실행 버튼 클릭', code: 'GitLab Pipelines > ▶ deploy:production' },
      { who: 'IT팀', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200', action: '운영 배포 확인 및 ITSM 기록', detail: 'ITSM 티켓 → 댓글: "운영 배포 완료. 확인 요청드립니다." → 상태를 "운영반영완료(released)"로 변경', code: '상태 → 운영반영완료(released)로 변경 후 댓글 등록' },
      { who: '현업', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200', action: '최종 완료 처리', detail: 'ITSM 포털 → 해당 티켓 → 완료 처리 → 티켓 Closed (Epic: done)', code: '티켓 상태 → 종료(closed)' },
    ],
  },
]

const STATUS_GAP_ROWS = [
  { desired: 'open (요청등록)',               itsm: '접수됨 (open)',                     match: true,  note: '' },
  { desired: 'approved (승인완료)',            itsm: '승인완료 (approved)',               match: true,  note: '' },
  { desired: 'in-progress (개발진행)',         itsm: '처리중 (in_progress)',              match: true,  note: '동일 상태 사용' },
  { desired: 'waiting (대기중)',               itsm: '대기중 (waiting)',                  match: true,  note: '외부 대기 또는 보류 시 사용' },
  { desired: 'resolved (처리완료)',            itsm: '처리완료 (resolved)',               match: true,  note: '개발 완료 후 테스트 전 단계' },
  { desired: 'testing (테스트)',               itsm: '테스트중 (testing)',                match: true,  note: 'status::testing 전용 상태' },
  { desired: 'ready-for-release (운영배포전)', itsm: '운영배포전 (ready_for_release)',    match: true,  note: '' },
  { desired: 'released (운영반영완료)',        itsm: '운영반영완료 (released)',           match: true,  note: '' },
  { desired: 'done (종료)',                    itsm: '종료 (closed)',                     match: true,  note: '' },
]

function ProcessStepCard({ step, index }: { step: ProcessStep; index: number }) {
  const [open, setOpen] = useState(index === 0)
  return (
    <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
      <button
        type="button"
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
          {step.phase}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 dark:text-gray-100">{step.title}</div>
          <div className={`text-xs mt-0.5 font-medium ${step.actorColor}`}>{step.actor}</div>
        </div>
        {step.gitlabDirect && (
          <span className="shrink-0 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 border border-orange-200 dark:border-orange-800 rounded px-2 py-0.5">GitLab 직접</span>
        )}
        <span className="text-gray-400 dark:text-gray-500 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="space-y-3 mt-4">
            {step.steps.map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-5 h-5 rounded-full bg-white dark:bg-gray-900 border-2 border-blue-300 dark:border-blue-700 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-400 shrink-0">
                    {i + 1}
                  </div>
                  {i < step.steps.length - 1 && <div className="w-0.5 flex-1 bg-blue-100 dark:bg-blue-900/30 my-1 min-h-[12px]" />}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.color}`}>{s.who}</span>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.action}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{s.detail}</p>
                  {s.code && (
                    <pre className="mt-2 text-xs bg-gray-800 text-green-300 rounded-lg px-3 py-2 font-mono whitespace-pre-wrap leading-relaxed">{s.code}</pre>
                  )}
                </div>
              </div>
            ))}
          </div>
          {step.note && (
            <div className="mt-3 flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <span className="text-blue-500 text-xs shrink-0 mt-0.5">💡</span>
              <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">{step.note}</p>
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
                <span className="bg-white/20 text-white rounded px-2 py-0.5 font-medium">{s}</span>
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
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-3 bg-gray-100 dark:bg-gray-700/50 px-4 py-2 text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            <span>프로세스 용어</span>
            <span>ITSM 구현체</span>
            <span>상세</span>
          </div>
          {TERM_MAP.map((row, i) => (
            <div key={i} className={`grid grid-cols-3 px-4 py-3 text-sm border-t dark:border-gray-700 ${row.color}`}>
              <span className="font-medium text-gray-800 dark:text-gray-100 leading-snug pr-2">{row.term}</span>
              <span className="font-semibold text-gray-900 dark:text-white pr-2">{row.itsm}</span>
              <span className="text-gray-500 dark:text-gray-400 text-xs leading-snug">{row.note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 단계별 프로세스 */}
      <section className="mb-8">
        <SectionTitle number="3" title="단계별 프로세스 (아코디언)" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">각 단계를 클릭하면 상세 수행 방법을 확인합니다.</p>
        <div className="space-y-3">
          {PROCESS_STEPS.map((step, i) => (
            <ProcessStepCard key={step.id} step={step} index={i} />
          ))}
        </div>
      </section>

      {/* 브랜치 전략 */}
      <section className="mb-8">
        <SectionTitle number="4" title="브랜치 · 태그 전략" />
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-sm p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            {[
              { branch: 'feature/*', color: 'border-orange-400 bg-orange-50 dark:bg-orange-900/20', textColor: 'text-orange-800 dark:text-orange-200', badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300', desc: '개별 기능 개발용. GitLab Issue에서 생성. 개발 완료 후 main으로 MR.', from: 'Issue', to: 'main' },
              { branch: 'main',      color: 'border-blue-400 bg-blue-50 dark:bg-blue-900/20',    textColor: 'text-blue-800 dark:text-blue-200',   badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',   desc: '통합 개발 기준 브랜치. 개발기/테스트기 배포 기준. 검증 후 release로 MR.', from: 'feature/*', to: 'release' },
              { branch: 'release',   color: 'border-green-400 bg-green-50 dark:bg-green-900/20',  textColor: 'text-green-800 dark:text-green-200',  badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300', desc: '운영 반영 기준 브랜치. v*.*.* 태그를 이 브랜치에서 생성.', from: 'main', to: '운영 서버' },
            ].map((b) => (
              <div key={b.branch} className={`rounded-xl border-2 p-4 ${b.color}`}>
                <code className={`font-bold text-base font-mono ${b.textColor}`}>{b.branch}</code>
                <p className={`text-xs mt-2 leading-relaxed ${b.textColor} opacity-90`}>{b.desc}</p>
                <div className="mt-3 flex items-center gap-1 text-xs">
                  <span className={`px-2 py-0.5 rounded font-mono ${b.badge}`}>{b.from}</span>
                  <span className="text-gray-400 dark:text-gray-500">→</span>
                  <span className={`px-2 py-0.5 rounded font-mono ${b.badge}`}>{b.to}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t dark:border-gray-700 pt-4">
            <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">배포 태그 규칙</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { tag: 'dev-YYYYMMDD', env: '개발기', auto: true, color: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-300 dark:border-cyan-700 text-cyan-800 dark:text-cyan-200', badge: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300', who: 'PL', from: 'main' },
                { tag: 'stg-YYYYMMDD', env: '테스트기', auto: true, color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200', badge: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300', who: 'PL', from: 'main' },
                { tag: 'v1.2.3',       env: '운영기', auto: false, color: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200', badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', who: 'IT팀', from: 'release' },
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
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-12 bg-gray-100 dark:bg-gray-700/50 px-4 py-2 text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            <span className="col-span-4">프로세스 Epic 상태</span>
            <span className="col-span-4">ITSM 티켓 상태</span>
            <span className="col-span-1 text-center">일치</span>
            <span className="col-span-3">비고</span>
          </div>
          {STATUS_GAP_ROWS.map((row, i) => (
            <div key={i} className="grid grid-cols-12 px-4 py-3 text-sm border-t dark:border-gray-700 items-start">
              <span className="col-span-4 font-medium text-gray-800 dark:text-gray-100 leading-snug pr-2">{row.desired}</span>
              <span className="col-span-4 font-semibold text-gray-900 dark:text-white pr-2">{row.itsm}</span>
              <span className="col-span-1 text-center text-base">{row.match ? '✅' : '⚠️'}</span>
              <span className="col-span-3 text-xs text-gray-500 dark:text-gray-400 leading-snug">{row.note}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
          <span className="text-green-500 shrink-0 mt-0.5 text-base">✅</span>
          <div className="text-sm text-green-800 dark:text-green-200 leading-relaxed">
            모든 프로세스 Epic 상태가 ITSM 티켓 상태와 1:1 매핑됩니다. 9개 상태(<code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">open</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">approved</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">in_progress</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">waiting</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">resolved</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">testing</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">ready_for_release</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">released</code> → <code className="bg-green-100 dark:bg-green-900/30 px-1 rounded text-xs">closed</code>) 모두 지원됩니다.
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 탭: FAQ ────────────────────────────────────────────────────────── */

function TabFaq() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState<string>('전체')
  const [apiItems, setApiItems] = useState<ApiFaqItem[]>([])
  const [loadingApi, setLoadingApi] = useState(true)

  useEffect(() => {
    fetchFaqItems({ active_only: true })
      .then(setApiItems)
      .catch(() => setApiItems([]))
      .finally(() => setLoadingApi(false))
  }, [])

  const sourceItems: Array<{ id: number; q: string; a: string; cat: string }> =
    apiItems.map(i => ({ id: i.id, q: i.question, a: i.answer, cat: i.category ?? '기타' }))

  const catCounts = sourceItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.cat] = (acc[item.cat] ?? 0) + 1
    return acc
  }, {})

  const catOrder = FAQ_CAT_ORDER.filter(c => catCounts[c])

  const filtered = sourceItems.filter(item => {
    const matchesCat = activeCat === '전체' || item.cat === activeCat
    const q = search.toLowerCase()
    const matchesSearch = !q || item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q)
    return matchesCat && matchesSearch
  })

  if (loadingApi) {
    return (
      <div className="text-center py-16 text-gray-400 dark:text-gray-500">
        <div className="text-3xl mb-2 animate-pulse">⏳</div>
        <p className="text-sm">FAQ를 불러오는 중...</p>
      </div>
    )
  }

  return (
    <div>
      {/* 검색 */}
      <div className="mb-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setOpenIdx(null) }}
            placeholder="질문이나 키워드로 검색..."
            className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
            >✕</button>
          )}
        </div>
      </div>

      {/* 카테고리 필터 */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => { setActiveCat('전체'); setOpenIdx(null) }}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            activeCat === '전체'
              ? 'bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          전체 <span className="opacity-60">{sourceItems.length}</span>
        </button>
        {catOrder.map(cat => {
          const cfg = FAQ_CAT_CONFIG[cat] ?? { icon: '❓', color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-800', ring: 'border-gray-300 dark:border-gray-600' }
          const isActive = activeCat === cat
          return (
            <button
              key={cat}
              onClick={() => { setActiveCat(cat); setOpenIdx(null) }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                isActive
                  ? `${cfg.bg} ${cfg.color}`
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {cfg.icon} {cat} <span className="opacity-60">{catCounts[cat]}</span>
            </button>
          )
        })}
      </div>

      {/* 검색 결과 없음 */}
      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm">검색 결과가 없습니다.</p>
          <button onClick={() => { setSearch(''); setActiveCat('전체') }} className="mt-3 text-xs text-blue-500 hover:underline">
            필터 초기화
          </button>
        </div>
      )}

      {/* FAQ 아코디언 */}
      <div className="space-y-2">
        {filtered.map((item) => {
          const isOpen = openIdx === item.id
          const cfg = FAQ_CAT_CONFIG[item.cat] ?? { icon: '❓', color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-800', ring: 'border-gray-300 dark:border-gray-600' }
          return (
            <div
              key={item.id}
              className={`bg-white dark:bg-gray-900 border rounded-xl overflow-hidden shadow-sm transition-all ${
                isOpen ? `${cfg.ring} shadow-sm` : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <button
                type="button"
                className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                onClick={() => setOpenIdx(isOpen ? null : item.id)}
                aria-expanded={isOpen}
              >
                <span className="text-blue-500 font-bold text-sm shrink-0 mt-0.5">Q</span>
                <span className="flex-1 font-medium text-sm text-gray-800 dark:text-gray-100 leading-relaxed">{item.q}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                    {cfg.icon} {item.cat}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs">{isOpen ? '▲' : '▼'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-gray-100 dark:border-gray-700 pt-4 bg-gray-50/50 dark:bg-gray-800/20">
                  <div className="flex gap-3">
                    <span className="text-teal-500 font-bold text-sm shrink-0 mt-0.5">A</span>
                    <div className="flex-1 min-w-0">
                      <AnswerContent text={item.a} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 결과 수 표시 */}
      {(search || activeCat !== '전체') && filtered.length > 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-right mt-3">
          {filtered.length}개 항목
        </p>
      )}
    </div>
  )
}

/* ─── ZENITH 소개 탭 ──────────────────────────────────────────────────── */

function TabAbout() {
  return (
    <div className="space-y-8 max-w-4xl">

      {/* 히어로 */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-lg">
        <div className="flex items-start gap-5">
          <div className="text-5xl shrink-0">⚡</div>
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight mb-2">ZENITH</h2>
            <p className="text-blue-100 text-base leading-relaxed mb-4">
              협력사 개발팀과 IT 운영팀 간의 서비스 요청·이슈를 체계적으로 접수·처리·추적하는
              <br />사내 IT 서비스 관리(ITSM) 플랫폼입니다.
            </p>
            <div className="flex flex-wrap gap-2">
              {['GitLab 기반', 'SLA 관리', '9단계 워크플로우', '5단계 RBAC', '실시간 알림'].map(tag => (
                <span key={tag} className="text-xs bg-white/20 text-white px-3 py-1 rounded-full font-medium">{tag}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 개발 배경 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-xl">💡</span> 개발 배경
        </h3>
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          <p>
            개발자와 IT 담당자 사이의 서비스 요청은 그동안 이메일·메신저·구두 등 비공식 채널에
            분산되어 있었습니다. 이로 인해 요청 누락, 처리 지연, 담당자 불명확, SLA 위반 파악 불가 등의
            문제가 반복되었습니다.
          </p>
          <p>
            ZENITH는 이러한 문제를 해결하기 위해 GitLab 이슈 트래커를 백엔드 기반으로 삼아
            <strong className="text-gray-800 dark:text-gray-100"> PL·개발자 → IT 담당자 → 시스템관리자</strong>로
            이어지는 명확한 역할 분리와 투명한 처리 흐름을 구현했습니다.
          </p>
          <p>
            단순 티켓 관리에 그치지 않고 지식베이스(KB), 성과 리포트, 칸반 보드, 고객 포털,
            에스컬레이션 정책, 아웃바운드 웹훅 등을 통합해 <strong className="text-gray-800 dark:text-gray-100">
            운영 전반을 한 플랫폼에서 관리</strong>할 수 있도록 설계되었습니다.
          </p>
        </div>
      </div>

      {/* 핵심 가치 */}
      <div>
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-xl">🎯</span> 핵심 가치
        </h3>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              icon: '🔍',
              title: '투명성',
              desc: '모든 요청과 처리 이력이 기록되며, 신청자·담당자·관리자 모두 실시간으로 진행 상태를 확인할 수 있습니다.',
            },
            {
              icon: '⚡',
              title: '효율성',
              desc: 'SLA 자동 추적, 자동 배정 규칙, 에스컬레이션 정책으로 반복 업무를 줄이고 빠른 처리를 유도합니다.',
            },
            {
              icon: '🔒',
              title: '보안·통제',
              desc: '5단계 RBAC으로 역할별 접근을 제한하고, 모든 주요 변경 사항은 감사 로그에 기록됩니다.',
            },
          ].map(v => (
            <div key={v.title} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-5 shadow-sm">
              <div className="text-2xl mb-2">{v.icon}</div>
              <h4 className="font-semibold text-gray-800 dark:text-gray-100 mb-1.5">{v.title}</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 주요 구성 요소 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-xl">🧩</span> 주요 구성 요소
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { icon: '🎫', name: '티켓 관리',       desc: '접수부터 운영반영까지 9단계 상태 워크플로우' },
            { icon: '📋', name: '지식베이스(KB)',   desc: '운영 노하우·매뉴얼을 팀 내 공유하는 문서 저장소' },
            { icon: '📊', name: '성과 리포트',      desc: '상태별·담당자별·월별 처리 현황 통계' },
            { icon: '🗂️', name: '칸반 보드',        desc: '드래그&드롭으로 티켓 상태를 시각적으로 관리' },
            { icon: '🌐', name: '고객 포털',        desc: '로그인 없이 티켓을 접수하고 처리 현황을 조회' },
            { icon: '🔔', name: '알림 채널',        desc: '이메일·텔레그램·인앱 알림으로 실시간 이벤트 전달' },
            { icon: '⏱️', name: 'SLA & 에스컬레이션', desc: '우선순위별 응답·해결 목표 시간 자동 추적 및 경보' },
            { icon: '🔗', name: '아웃바운드 웹훅',  desc: 'Slack·Teams 등 외부 시스템과 이벤트 연동' },
          ].map(c => (
            <div key={c.name} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <span className="text-lg shrink-0">{c.icon}</span>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{c.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 기술 스택 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-xl">🛠️</span> 기술 스택
        </h3>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              layer: 'Backend',
              color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
              badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
              items: [
                { name: 'Python 3.13',     role: '언어' },
                { name: 'FastAPI 0.115',   role: 'API 프레임워크' },
                { name: 'SQLAlchemy',      role: 'ORM' },
                { name: 'Alembic',         role: 'DB 마이그레이션' },
                { name: 'Jinja2',          role: '이메일 템플릿 렌더링' },
                { name: 'python-magic',    role: '파일 보안 검증' },
              ],
            },
            {
              layer: 'Frontend',
              color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
              badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
              items: [
                { name: 'Next.js 15',      role: 'React 프레임워크' },
                { name: 'TypeScript',      role: '타입 안전성' },
                { name: 'Tailwind CSS',    role: 'UI 스타일링' },
                { name: 'React 19',        role: 'UI 라이브러리' },
              ],
            },
            {
              layer: '인프라 / 데이터',
              color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
              badge: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700',
              items: [
                { name: 'PostgreSQL 17',   role: '주 데이터베이스' },
                { name: 'Redis 7.4',       role: '캐시 · 세션 · Pub/Sub' },
                { name: 'GitLab CE',       role: '이슈 트래커 · OAuth' },
                { name: 'ClamAV',          role: '업로드 파일 바이러스 스캔' },
              ],
            },
            {
              layer: '운영 · 관찰',
              color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
              badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
              items: [
                { name: 'Docker Compose',  role: '컨테이너 오케스트레이션' },
                { name: 'Nginx',           role: '리버스 프록시' },
                { name: 'Prometheus',      role: '메트릭 수집' },
                { name: 'Grafana',         role: '대시보드 시각화' },
              ],
            },
          ].map(stack => (
            <div key={stack.layer} className={`border dark:border-gray-700 rounded-lg p-4 ${stack.color}`}>
              <p className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block mb-3 ${stack.badge}`}>
                {stack.layer}
              </p>
              <div className="space-y-1.5">
                {stack.items.map(item => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-800 dark:text-gray-100">{item.name}</span>
                    <span className="text-gray-500 dark:text-gray-400">{item.role}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* GitLab 연동 구조 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-xl">🦊</span> GitLab 연동 구조
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
          ZENITH는 GitLab 이슈를 티켓의 실제 저장소로 사용합니다. 상태·우선순위·카테고리는 GitLab
          라벨(Label)로 표현되며, 담당자 배정은 GitLab Assignee와 동기화됩니다.
          사용자 인증은 GitLab OAuth 2.0으로 처리합니다.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          {[
            { label: '티켓 상태',   value: 'status::open, status::in_progress … (9종)' },
            { label: '우선순위',    value: 'prio::critical, prio::high, prio::medium, prio::low' },
            { label: '카테고리',    value: 'cat::network, cat::hardware … (관리자 설정)' },
            { label: '인증',        value: 'GitLab OAuth 2.0 · 세션 쿠키(HttpOnly)' },
            { label: '이슈 상태',   value: 'opened (진행중) · closed (종료)' },
            { label: '웹훅 수신',   value: 'GitLab → ZENITH 이벤트 동기화' },
          ].map(r => (
            <div key={r.label} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">{r.label}</p>
              <p className="text-gray-500 dark:text-gray-400 break-all">{r.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 버전 정보 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-xl">📌</span> 버전 정보
        </h3>
        <div className="space-y-2">
          {[
            { version: 'v1.0',   desc: '티켓 접수·처리 기본 워크플로우, GitLab OAuth 인증, SLA 정책' },
            { version: 'v1.1',   desc: '지식베이스(KB), 에스컬레이션 정책, 이메일 템플릿 관리' },
            { version: 'v1.2',   desc: '칸반 보드, 성과 리포트, 고객 포털, 아웃바운드 웹훅' },
            { version: 'v1.3',   desc: 'testing 상태 추가, PL 역할(5단계 RBAC), 알림 채널 ON/OFF 관리' },
            { version: 'v1.4',   desc: '칸반 종료됨 컬럼 접기/펼치기, 감사 로그 액션 레이블 정확도 개선, 역할별 시작 가이드 도움말 추가' },
            { version: 'v1.5',   desc: '보안 강화(IP 허용목록·JWT 블랙리스트), 승인 워크플로우, 티켓 유형 관리, 다크모드 FOUC 수정' },
            { version: 'v1.6',   desc: '테스트 커버리지 97%·CI 95% 강제, Grafana 알림 대시보드, Rate Limit 메트릭, Next.js 번들 최적화, API 계약 테스트' },
          ].map(v => (
            <div key={v.version} className="flex items-start gap-3 text-sm">
              <span className="shrink-0 font-mono font-bold text-blue-600 dark:text-blue-400 w-12">{v.version}</span>
              <span className="text-gray-600 dark:text-gray-400">{v.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 소스코드 */}
      <div className="bg-gray-900 dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 24 24" className="w-10 h-10 text-white fill-current shrink-0" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <div>
              <p className="text-white font-bold text-base">GitHub 소스코드</p>
              <p className="text-gray-400 text-sm mt-0.5">ZENITH ITSM 전체 소스코드가 공개되어 있습니다.</p>
            </div>
          </div>
          <a
            href="https://github.com/ywjung/zenith"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-gray-100 text-gray-900 text-sm font-semibold rounded-lg transition-colors shrink-0"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            ywjung/zenith
          </a>
        </div>
      </div>

    </div>
  )
}

/* ─── 메인 페이지 컴포넌트 ───────────────────────────────────────────── */

export default function HelpPage() {
  const [activeTab, setActiveTab] = useState<TabId>('start')

  useEffect(() => {
    const hash = window.location.hash.replace('#', '') as TabId
    if (TABS.some(t => t.id === hash)) setActiveTab(hash)
  }, [])

  const handleTabChange = (id: TabId) => {
    setActiveTab(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800/50">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-900 border-b dark:border-gray-700 shadow-sm">
        <div className="w-full px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">ZENITH 도움말</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">IT 서비스 관리 플랫폼 사용 안내 및 기술 문서</p>
        </div>

        {/* 탭 네비게이션 — sticky, 모바일 스크롤 */}
        <div className="w-full px-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`
                  shrink-0 px-4 py-3 text-sm font-medium rounded-t-lg transition-colors min-h-[44px]
                  ${activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700'
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
        {activeTab === 'workload' && <TabWorkloadPerf />}
        {activeTab === 'perf'     && <TabPerf />}
        {activeTab === 'arch'     && <TabArch />}
        {activeTab === 'api'      && <TabApi />}
        {activeTab === 'faq'      && <TabFaq />}
        {activeTab === 'about'    && <TabAbout />}
      </div>

      {/* 푸터 */}
      <div className="border-t dark:border-gray-700 bg-white dark:bg-gray-900 mt-8">
        <div className="w-full px-4 py-6 text-center text-xs text-gray-400 dark:text-gray-500 space-y-1">
          <div>
            <Link href="http://localhost:8111/docs" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Swagger UI</Link>
            {' · '}
            <Link href="http://localhost:8111/redoc" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">ReDoc</Link>
            {' · '}
            <Link href="http://localhost:9090" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Prometheus</Link>
            {' · '}
            <Link href="http://localhost:3001" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Grafana</Link>
          </div>
          <div>ZENITH · Python 3.13 · FastAPI 0.135 · Next.js 15 · PostgreSQL 17 · Redis 7.4 · Alembic 52단계</div>
        </div>
      </div>
    </div>
  )
}
