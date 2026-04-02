"""ITSM 다양한 샘플 데이터 시드 스크립트.

- 일반 티켓 50건 (다양한 날짜·카테고리·우선순위·상태)
- 문제(Problem) 티켓 6건 + 인시던트 연결
- 변경(Change) 요청 8건
"""
import json, random, sys, time
from datetime import datetime, timedelta, timezone
import psycopg2
import requests

# ── 연결 설정 ────────────────────────────────────────────────────────────────
GITLAB_URL   = "http://gitlab:8929"
GITLAB_TOKEN = "glpat-moCp2tCHyFJhFlUKENypnm86MQp1OjEH.01.0w1o77nex"
PROJECT_ID   = "1"
HEADERS      = {"PRIVATE-TOKEN": GITLAB_TOKEN, "Content-Type": "application/json"}
PG = dict(host="postgres", port=5432, dbname="itsm", user="itsm", password="change_me_secure_password")

# ── 사용자 정보 ──────────────────────────────────────────────────────────────
USERS = {
    "root":       {"id": 1,  "name": "관리자",  "dept": "IT팀",    "role": "admin"},
    "agent_kim":  {"id": 7,  "name": "김민지",  "dept": "IT팀",    "role": "agent"},
    "agent_park": {"id": 8,  "name": "박서준",  "dept": "IT팀",    "role": "agent"},
    "pl_lee":     {"id": 9,  "name": "이지현",  "dept": "IT팀",    "role": "pl"},
    "dev_choi":   {"id": 10, "name": "최우진",  "dept": "개발팀",  "role": "developer"},
    "dev_song":   {"id": 11, "name": "송예린",  "dept": "개발팀",  "role": "developer"},
    "user_han":   {"id": 12, "name": "한수빈",  "dept": "개발팀",  "role": "user"},
    "user_jung":  {"id": 13, "name": "정다은",  "dept": "마케팅팀","role": "user"},
    "user_oh":    {"id": 14, "name": "오승현",  "dept": "경영지원팀","role": "user"},
}

REQUESTERS = ["user_han", "user_jung", "user_oh", "dev_choi", "dev_song"]
AGENTS     = ["agent_kim", "agent_park"]
NOW        = datetime.now(timezone.utc)

def days_ago(n, hour=9, jitter=True):
    d = NOW - timedelta(days=n, hours=random.randint(0,4) if jitter else 0, minutes=random.randint(0,59) if jitter else 0)
    return d

def gl_post(path, payload, sudo=None):
    h = dict(HEADERS)
    if sudo:
        h["Sudo"] = str(sudo)
    r = requests.post(f"{GITLAB_URL}/api/v4{path}", headers=h, json=payload, timeout=20)
    if not r.ok:
        print(f"  ⚠  POST {path} {r.status_code}: {r.text[:120]}")
        return None
    return r.json()

def gl_put(path, payload, sudo=None):
    h = dict(HEADERS)
    if sudo:
        h["Sudo"] = str(sudo)
    r = requests.put(f"{GITLAB_URL}/api/v4{path}", headers=h, json=payload, timeout=20)
    if not r.ok:
        print(f"  ⚠  PUT {path} {r.status_code}: {r.text[:120]}")
        return None
    return r.json()

def close_issue(iid):
    return gl_put(f"/projects/{PROJECT_ID}/issues/{iid}", {"state_event": "close"})

def add_comment(iid, body, sudo=None):
    return gl_post(f"/projects/{PROJECT_ID}/issues/{iid}/notes", {"body": body}, sudo=sudo)

# ════════════════════════════════════════════════════════════════════════════
# 1. 일반 티켓 50건
# ════════════════════════════════════════════════════════════════════════════

TICKETS = [
    # ── 네트워크 ────────────────────────────────────────────────────────────
    {
        "title": "[긴급] 사내 네트워크 전체 다운",
        "labels": ["status::open","prio::critical","cat::네트워크","incident"],
        "author": "user_han", "assignee": "agent_kim", "days": 0,
        "body": "오전 8시 50분부터 사내 유선 인터넷이 전면 불통입니다.\n전체 부서 업무 중단 상태입니다.",
        "comments": [
            ("agent_kim", "현재 코어 스위치 장애 확인 중입니다."),
            ("agent_kim", "L3 스위치 재부팅 후 복구 작업 진행 중입니다."),
        ]
    },
    {
        "title": "VPN 연결 불안정 — 재택근무 팀 전체",
        "labels": ["status::in_progress","prio::high","cat::네트워크"],
        "author": "dev_choi", "assignee": "agent_park", "days": 1,
        "body": "VPN 연결이 30분마다 끊깁니다. 재택 개발팀 전원 영향.",
        "comments": [("agent_park", "SSL-VPN 세션 타임아웃 설정 확인 중입니다.")]
    },
    {
        "title": "3층 무선 AP 신호 불량",
        "labels": ["status::waiting","prio::medium","cat::네트워크"],
        "author": "user_jung", "assignee": "agent_kim", "days": 3,
        "body": "3층 회의실 A~C 구역에서 Wi-Fi 연결이 자주 끊깁니다.",
        "comments": [
            ("agent_kim", "AP 현장 점검 완료. 채널 간섭 발견."),
            ("agent_kim", "채널 변경 및 전파 출력 조정 후 사용자 확인 요청드립니다."),
        ]
    },
    {
        "title": "인터넷 속도 저하 (다운로드 1Mbps 이하)",
        "labels": ["status::resolved","prio::high","cat::네트워크"],
        "author": "user_oh", "assignee": "agent_park", "days": 7,
        "body": "오늘 오후부터 인터넷 다운로드 속도가 1Mbps 이하로 떨어졌습니다.",
        "close": True,
        "comments": [
            ("agent_park", "ISP 회선 점검 요청 완료."),
            ("agent_park", "ISP 확인 결과 — 백본 장비 교체 후 정상화 완료."),
        ]
    },
    {
        "title": "방화벽 정책 변경 요청 — 개발 서버 포트 오픈",
        "labels": ["status::open","prio::medium","cat::네트워크","service_request"],
        "author": "dev_song", "assignee": "agent_kim", "days": 2,
        "body": "개발 서버(192.168.10.50) TCP 8443 포트를 사내망에서 허용해주세요.",
        "comments": []
    },
    # ── 하드웨어 ────────────────────────────────────────────────────────────
    {
        "title": "노트북 SSD 불량 — 부팅 불가",
        "labels": ["status::in_progress","prio::high","cat::하드웨어"],
        "author": "user_jung", "assignee": "agent_park", "days": 1,
        "body": "노트북 부팅 시 'No bootable device' 오류. 긴급 교체 필요.\n모델: ThinkPad X1 Carbon Gen 10, S/N: X1C-2024-042",
        "comments": [("agent_park", "재고 확인 완료 — 내일 오전 교체 예정입니다.")]
    },
    {
        "title": "데스크탑 모니터 전원 불량 (2대)",
        "labels": ["status::open","prio::medium","cat::하드웨어"],
        "author": "user_han", "assignee": "agent_kim", "days": 4,
        "body": "마케팅팀 3번, 7번 자리 모니터 전원이 들어오지 않습니다.",
        "comments": []
    },
    {
        "title": "복합기(4층) 용지 걸림 잦음",
        "labels": ["status::resolved","prio::low","cat::하드웨어"],
        "author": "user_oh", "assignee": "agent_park", "days": 10,
        "body": "4층 복합기(HP LaserJet Pro) 용지 걸림이 하루 3~4회 발생합니다.",
        "close": True,
        "comments": [
            ("agent_park", "픽업 롤러 교체 완료."),
        ]
    },
    {
        "title": "마우스·키보드 무선 수신기 분실",
        "labels": ["status::closed","prio::low","cat::하드웨어","service_request"],
        "author": "user_jung", "assignee": "agent_kim", "days": 14,
        "body": "Logitech MK370 무선 수신기(USB 동글) 분실. 교체 요청드립니다.",
        "close": True,
        "comments": [("agent_kim", "수신기 지급 완료.")]
    },
    {
        "title": "서버실 UPS 배터리 교체 필요",
        "labels": ["status::waiting","prio::high","cat::하드웨어"],
        "author": "agent_park", "assignee": "pl_lee", "days": 5,
        "body": "서버실 UPS(APC Smart-UPS 3000) 배터리 잔량 경고 알림 발생. 예방 교체 권장.",
        "comments": [("pl_lee", "구매 품의 진행 중. 납기 1주일 예상.")]
    },
    # ── 소프트웨어 ───────────────────────────────────────────────────────────
    {
        "title": "사내 ERP 로그인 오류 500",
        "labels": ["status::in_progress","prio::critical","cat::소프트웨어","incident"],
        "author": "user_oh", "assignee": "dev_choi", "days": 0,
        "body": "ERP 시스템 로그인 시 Internal Server Error 500이 발생합니다. 경영지원팀 전원 영향.",
        "comments": [
            ("dev_choi", "DB 연결 풀 고갈 확인 중."),
            ("dev_choi", "연결 풀 설정 조정 후 모니터링 중입니다."),
        ]
    },
    {
        "title": "MS Teams 화상회의 화면 공유 안 됨",
        "labels": ["status::open","prio::medium","cat::소프트웨어"],
        "author": "user_han", "assignee": "agent_park", "days": 2,
        "body": "Teams 화면 공유 시 상대방에게 검은 화면만 보입니다.\n그래픽 드라이버 업데이트 후 발생.",
        "comments": [("agent_park", "그래픽 드라이버 이전 버전으로 롤백 안내 드립니다.")]
    },
    {
        "title": "Adobe Acrobat PDF 인쇄 시 글자 깨짐",
        "labels": ["status::waiting","prio::medium","cat::소프트웨어"],
        "author": "user_jung", "assignee": "agent_kim", "days": 6,
        "body": "계약서 PDF 인쇄 시 한글 폰트가 깨져 출력됩니다.",
        "comments": [
            ("agent_kim", "Acrobat 업데이트 및 프린터 드라이버 재설치 안내."),
            ("user_jung", "동일 증상 지속됩니다. 추가 확인 부탁드립니다."),
        ]
    },
    {
        "title": "구매 요청: Figma 팀 라이선스 5석",
        "labels": ["status::open","prio::low","cat::소프트웨어","service_request"],
        "author": "dev_song", "assignee": "pl_lee", "days": 3,
        "body": "디자인 협업을 위한 Figma Professional 라이선스 5석 구매 요청.\n예산: 월 $75 예상.",
        "comments": []
    },
    {
        "title": "업무용 PC AutoCAD 설치 요청",
        "labels": ["status::resolved","prio::medium","cat::소프트웨어","service_request"],
        "author": "user_oh", "assignee": "agent_park", "days": 15,
        "body": "설계팀 신규 PC AutoCAD 2024 설치 요청. 라이선스 키 보유.",
        "close": True,
        "comments": [("agent_park", "설치 완료. 라이선스 활성화 확인.")]
    },
    {
        "title": "Slack 알림이 오지 않음 (iOS)",
        "labels": ["status::resolved","prio::medium","cat::소프트웨어"],
        "author": "user_han", "assignee": "agent_kim", "days": 20,
        "body": "아이폰 Slack 앱 푸시 알림이 2일째 오지 않습니다.",
        "close": True,
        "comments": [
            ("agent_kim", "iOS 알림 설정 및 Slack 알림 권한 재설정 안내."),
            ("user_han", "해결됐습니다! 감사합니다."),
        ]
    },
    # ── 보안 ────────────────────────────────────────────────────────────────
    {
        "title": "[긴급] 피싱 이메일 수신 — 악성 링크 클릭 의심",
        "labels": ["status::in_progress","prio::critical","cat::보안","incident","security"],
        "author": "user_jung", "assignee": "agent_kim", "days": 1,
        "body": "외부 발신자('no-reply@amaz0n-security.com')로부터 피싱 이메일 수신.\n링크 클릭 후 로그인 시도한 것 같습니다. 즉각 조치 요청.",
        "comments": [
            ("agent_kim", "해당 계정 비밀번호 즉시 초기화 및 세션 강제 종료 완료."),
            ("agent_kim", "EDR 에이전트 스캔 실행 중. 격리 여부 확인 예정."),
        ]
    },
    {
        "title": "의심스러운 외부 접근 시도 감지 (SSH)",
        "labels": ["status::resolved","prio::high","cat::보안","incident"],
        "author": "agent_park", "assignee": "pl_lee", "days": 8,
        "body": "웹서버(10.0.1.20) SSH 포트(22)에 대한 brute-force 공격 감지.\n24시간 내 1200회 시도.",
        "close": True,
        "comments": [
            ("pl_lee", "해당 IP 블랙리스트 등록 및 fail2ban 정책 강화 완료."),
            ("pl_lee", "SSH 포트 변경 및 키 기반 인증 전환 권고 발송."),
        ]
    },
    {
        "title": "퇴직자 계정 즉시 비활성화 요청",
        "labels": ["status::resolved","prio::high","cat::보안","service_request"],
        "author": "root", "assignee": "agent_kim", "days": 5,
        "body": "2024-12-31 퇴직자 3명 계정 즉시 비활성화 요청.\n대상: kim.sj, lee.mh, park.ys",
        "close": True,
        "comments": [("agent_kim", "3계정 비활성화 및 원격 세션 종료 완료.")]
    },
    {
        "title": "개인정보 처리방침 업데이트 후 시스템 반영 요청",
        "labels": ["status::open","prio::medium","cat::보안","service_request"],
        "author": "pl_lee", "assignee": "dev_choi", "days": 4,
        "body": "2025년 개정 개인정보 보호법 대응 — 처리방침 팝업 및 동의 로직 업데이트 필요.",
        "comments": []
    },
    {
        "title": "USB 보안 정책 예외 신청 — 외부 발표용",
        "labels": ["status::waiting","prio::low","cat::보안","service_request"],
        "author": "user_oh", "assignee": "agent_park", "days": 3,
        "body": "외부 컨퍼런스 발표용 USB 드라이브 일시 허용 요청. 기간: 2025-01-15 하루.",
        "comments": [("agent_park", "보안팀 승인 대기 중.")]
    },
    # ── 계정 관리 ────────────────────────────────────────────────────────────
    {
        "title": "신규 입사자 계정 일괄 생성 요청 (5명)",
        "labels": ["status::in_progress","prio::high","cat::계정관리","service_request"],
        "author": "root", "assignee": "agent_kim", "days": 1,
        "body": "2025년 1월 신규 입사자 5명 계정 생성 요청.\n입사일: 2025-01-06. 이메일·그룹웨어·ERP 계정 필요.",
        "comments": [("agent_kim", "이메일·그룹웨어 계정 생성 완료. ERP 계정 생성 중.")]
    },
    {
        "title": "비밀번호 초기화 요청 — ERP",
        "labels": ["status::resolved","prio::medium","cat::계정관리"],
        "author": "user_han", "assignee": "agent_park", "days": 12,
        "body": "ERP 시스템 비밀번호를 잊어버렸습니다. 초기화 부탁드립니다.",
        "close": True,
        "comments": [("agent_park", "임시 비밀번호 이메일로 발송 완료.")]
    },
    {
        "title": "부서 이동에 따른 권한 변경 요청",
        "labels": ["status::resolved","prio::medium","cat::계정관리","service_request"],
        "author": "pl_lee", "assignee": "agent_kim", "days": 18,
        "body": "박서영 대리 마케팅팀 → 영업팀 이동. 공유드라이브·그룹 권한 변경 필요.",
        "close": True,
        "comments": [("agent_kim", "권한 변경 완료. 기존 마케팅팀 접근 권한 회수.")]
    },
    {
        "title": "임직원 MFA 전사 적용 요청",
        "labels": ["status::open","prio::high","cat::계정관리","service_request"],
        "author": "root", "assignee": "dev_choi", "days": 7,
        "body": "보안 강화를 위한 전사 MFA(TOTP) 적용 프로젝트. 1단계: 관리자 계정 우선 적용.",
        "comments": [
            ("dev_choi", "OKTA 연동 방안 검토 중."),
        ]
    },
    {
        "title": "Active Directory 계정 잠김",
        "labels": ["status::resolved","prio::high","cat::계정관리"],
        "author": "user_oh", "assignee": "agent_park", "days": 2,
        "body": "AD 계정이 잠겨 로그인이 안 됩니다. 긴급 해제 요청.",
        "close": True,
        "comments": [("agent_park", "계정 잠금 해제 완료. 잠금 정책 안내.")]
    },
    # ── 스토리지 ────────────────────────────────────────────────────────────
    {
        "title": "공유 드라이브 용량 95% 도달 — 긴급 확장",
        "labels": ["status::in_progress","prio::critical","cat::스토리지"],
        "author": "agent_kim", "assignee": "pl_lee", "days": 0,
        "body": "팀 공유 드라이브(\\\\fileserver\\marketing) 용량이 95%에 도달했습니다. 즉각 확장 필요.",
        "comments": [("pl_lee", "스토리지 추가 용량 20TB 구매 승인 요청 중.")]
    },
    {
        "title": "백업 실패 알림 — DB 서버",
        "labels": ["status::resolved","prio::high","cat::스토리지","incident"],
        "author": "dev_choi", "assignee": "agent_park", "days": 9,
        "body": "어제 새벽 2시 DB 전체 백업 실패 알림. 원인 파악 및 재실행 필요.",
        "close": True,
        "comments": [
            ("agent_park", "백업 대상 경로 마운트 해제 확인. 마운트 재설정 후 수동 백업 성공."),
        ]
    },
    {
        "title": "NAS 마운트 끊김 (R&D팀)",
        "labels": ["status::resolved","prio::high","cat::스토리지"],
        "author": "dev_song", "assignee": "agent_kim", "days": 16,
        "body": "R&D팀 NAS 드라이브가 오전부터 마운트 해제된 상태입니다. 대용량 파일 접근 불가.",
        "close": True,
        "comments": [("agent_kim", "NFS 서비스 재시작 후 자동 마운트 복구 완료.")]
    },
    {
        "title": "개인 스토리지 쿼터 증량 요청",
        "labels": ["status::resolved","prio::low","cat::스토리지","service_request"],
        "author": "user_han", "days": 25, "assignee": "agent_park",
        "body": "개인 홈 디렉토리 용량이 꽉 찼습니다. 10GB → 20GB 증량 요청.",
        "close": True,
        "comments": [("agent_park", "쿼터 20GB로 증량 완료.")]
    },
    {
        "title": "테이프 백업 라이브러리 오류 코드 E05",
        "labels": ["status::waiting","prio::high","cat::스토리지"],
        "author": "agent_park", "days": 6, "assignee": "pl_lee",
        "body": "테이프 백업 라이브러리(IBM TS3500)에서 E05 오류. 테이프 교체 및 벤더 점검 필요.",
        "comments": [("pl_lee", "IBM 엔지니어 방문 일정 협의 중. ETA: 내주 화요일.")]
    },
    # ── 클라우드 / 기타 ───────────────────────────────────────────────────────
    {
        "title": "AWS S3 버킷 퍼블릭 노출 감지",
        "labels": ["status::resolved","prio::critical","cat::보안","incident","security"],
        "author": "dev_choi", "days": 30, "assignee": "pl_lee",
        "body": "AWS Config 규칙에서 S3 버킷 퍼블릭 ACL 감지. 즉시 비공개 전환 필요.",
        "close": True,
        "comments": [
            ("pl_lee", "버킷 퍼블릭 ACL 제거 및 버킷 정책 강화 완료."),
            ("pl_lee", "유출 데이터 없음 확인. AWS CloudTrail 조사 완료."),
        ]
    },
    {
        "title": "클라우드 비용 급증 — EC2 인스턴스 점검",
        "labels": ["status::resolved","prio::high","cat::클라우드"],
        "author": "dev_song", "days": 45, "assignee": "dev_choi",
        "body": "지난달 대비 AWS 비용 40% 증가. EC2 미사용 인스턴스 및 Reserved Instance 최적화 필요.",
        "close": True,
        "comments": [
            ("dev_choi", "좀비 인스턴스 7개 발견 및 종료. 절감 효과 월 $1,200 예상."),
        ]
    },
    {
        "title": "GitHub Actions 빌드 실패 — main 브랜치",
        "labels": ["status::resolved","prio::high","cat::소프트웨어","incident"],
        "author": "dev_choi", "days": 3, "assignee": "dev_song",
        "body": "main 브랜치 PR 머지 후 CI/CD 파이프라인 전체 실패.\n오류: Docker Hub rate limit exceeded",
        "close": True,
        "comments": [
            ("dev_song", "Docker Hub 인증 토큰 갱신 및 GitHub Secret 업데이트 완료."),
        ]
    },
    {
        "title": "사내 위키(Confluence) 검색 기능 장애",
        "labels": ["status::in_progress","prio::medium","cat::소프트웨어","incident"],
        "author": "user_jung", "days": 2, "assignee": "dev_choi",
        "body": "Confluence 검색 결과가 3일 전부터 나오지 않습니다. 전체 재인덱싱 필요로 보입니다.",
        "comments": [("dev_choi", "Elasticsearch 인덱스 재구축 진행 중. 완료 예상 4시간.")]
    },
    {
        "title": "IDC 입출입 카드키 등록 요청",
        "labels": ["status::resolved","prio::low","cat::계정관리","service_request"],
        "author": "pl_lee", "days": 20, "assignee": "root",
        "body": "신규 입사자 2명(이재원, 최수진) IDC 출입 카드키 등록 요청.",
        "close": True,
        "comments": [("root", "카드키 발급 및 등록 완료.")]
    },
    {
        "title": "전화 교환기(PBX) 통화 품질 불량",
        "labels": ["status::waiting","prio::medium","cat::네트워크"],
        "author": "user_oh", "days": 8, "assignee": "agent_kim",
        "body": "외부 통화 시 잡음 심함. 1층 영업팀 대표 전화번호(02-1234-5678) 영향.",
        "comments": [("agent_kim", "PBX 벤더 점검 요청 완료. 일정 대기 중.")]
    },
    {
        "title": "인터넷 전화(070) 등록 요청 — 신규 입사자",
        "labels": ["status::resolved","prio::low","cat::네트워크","service_request"],
        "author": "root", "days": 35, "assignee": "agent_park",
        "body": "신규 입사자 박민호 과장 인터넷 전화 단말기 등록 및 내선 번호 배정 요청.",
        "close": True,
        "comments": [("agent_park", "내선 번호 1042 배정 및 단말기 설정 완료.")]
    },
    {
        "title": "구글 워크스페이스 마이그레이션 지원 요청",
        "labels": ["status::open","prio::medium","cat::소프트웨어","service_request"],
        "author": "pl_lee", "days": 5, "assignee": "dev_choi",
        "body": "레거시 Exchange → Google Workspace 전환 프로젝트.\n1단계: 이메일 데이터 마이그레이션 계획 수립 필요.",
        "comments": []
    },
    {
        "title": "노트북 OS 업그레이드 — Windows 10 → 11",
        "labels": ["status::in_progress","prio::low","cat::소프트웨어","service_request"],
        "author": "user_han", "days": 10, "assignee": "agent_kim",
        "body": "Windows 10 지원 종료(2025-10) 대비 전사 W11 업그레이드 요청.\n대상: 본인 노트북(자산번호 LT-2022-087)",
        "comments": [("agent_kim", "호환성 검사 완료. 다음 주 업그레이드 예약.")]
    },
    {
        "title": "프린터 드라이버 배포 — 그룹 정책",
        "labels": ["status::resolved","prio::low","cat::소프트웨어","service_request"],
        "author": "agent_park", "days": 40, "assignee": "dev_choi",
        "body": "신규 HP 복합기 드라이버를 GPO로 전사 배포 요청.",
        "close": True,
        "comments": [("dev_choi", "GPO 스크립트 작성 및 배포 완료.")]
    },
    {
        "title": "화상회의 시스템 업그레이드 (대회의실)",
        "labels": ["status::open","prio::medium","cat::하드웨어","service_request"],
        "author": "pl_lee", "days": 2, "assignee": "agent_park",
        "body": "대회의실 화상회의 시스템(카메라·마이크·디스플레이) 노후화로 교체 요청.\n예상 비용: 약 500만원.",
        "comments": []
    },
    {
        "title": "랜섬웨어 모의훈련 환경 구성 요청",
        "labels": ["status::open","prio::medium","cat::보안","service_request"],
        "author": "pl_lee", "days": 1, "assignee": "dev_song",
        "body": "보안 인식 교육용 피싱·랜섬웨어 모의훈련 환경 구성. 격리된 테스트 VM 5대 필요.",
        "comments": []
    },
    {
        "title": "데이터베이스 슬로우 쿼리 성능 개선",
        "labels": ["status::in_progress","prio::high","cat::소프트웨어"],
        "author": "dev_song", "days": 4, "assignee": "dev_choi",
        "body": "ERP DB 슬로우 쿼리 Top 5 분석 결과 인덱스 누락 확인. 성능 개선 작업 요청.",
        "comments": [
            ("dev_choi", "실행 계획 분석 완료. 복합 인덱스 3개 추가 예정."),
            ("dev_choi", "INDEX 추가 완료. 쿼리 응답 시간 평균 200ms → 15ms."),
        ]
    },
    {
        "title": "SSL 인증서 만료 30일 전 갱신 요청",
        "labels": ["status::resolved","prio::high","cat::보안","service_request"],
        "author": "dev_song", "days": 28, "assignee": "dev_choi",
        "body": "www.company.com SSL 인증서 2025-01-30 만료 예정. 갱신 작업 요청.",
        "close": True,
        "comments": [("dev_choi", "Let's Encrypt 자동갱신 설정 완료. 6개월 연장.")]
    },
    {
        "title": "사내 모바일 MDM 등록 지원",
        "labels": ["status::open","prio::low","cat::계정관리","service_request"],
        "author": "user_jung", "days": 3, "assignee": "agent_park",
        "body": "업무용 스마트폰 MDM(MobileIron) 등록 방법 안내 및 지원 요청.\n기기: iPhone 15 Pro",
        "comments": []
    },
    {
        "title": "CI/CD 파이프라인 도입 지원 요청",
        "labels": ["status::open","prio::medium","cat::소프트웨어","service_request"],
        "author": "dev_song", "days": 7, "assignee": "dev_choi",
        "body": "신규 서비스 배포 자동화를 위한 Jenkins → GitLab CI 전환 지원 요청.",
        "comments": [("dev_choi", "GitLab CI 템플릿 공유 및 컨설팅 일정 협의 중.")]
    },
    {
        "title": "레거시 서버 OS 패치 적용 (CVE-2024-31082)",
        "labels": ["status::resolved","prio::critical","cat::보안"],
        "author": "dev_choi", "days": 60, "assignee": "dev_song",
        "body": "CVSS 9.8 CVE-2024-31082 긴급 패치 대상 서버 12대 패치 적용 요청.",
        "close": True,
        "comments": [
            ("dev_song", "12대 중 10대 패치 완료. 2대 재부팅 스케줄 조율 중."),
            ("dev_song", "전체 12대 패치 완료."),
        ]
    },
    {
        "title": "이메일 대용량 첨부파일 전송 실패",
        "labels": ["status::resolved","prio::medium","cat::소프트웨어"],
        "author": "user_han", "days": 50, "assignee": "agent_kim",
        "body": "30MB 이상 파일 이메일 첨부 시 전송 실패. Exchange 서버 첨부 파일 크기 제한 확인 필요.",
        "close": True,
        "comments": [("agent_kim", "Exchange 최대 첨부 파일 크기 50MB로 상향 완료.")]
    },
    {
        "title": "서버실 항온항습기 이상 알림",
        "labels": ["status::resolved","prio::critical","cat::하드웨어","incident"],
        "author": "agent_kim", "days": 90, "assignee": "pl_lee",
        "body": "서버실 온도 28°C 초과 경보 발생. 냉각 시스템 점검 필요.",
        "close": True,
        "comments": [
            ("pl_lee", "필터 막힘 확인. 청소 후 정상 온도(21°C) 복구."),
        ]
    },
    {
        "title": "인트라넷 게시판 첨부파일 다운로드 안 됨",
        "labels": ["status::resolved","prio::medium","cat::소프트웨어"],
        "author": "user_oh", "days": 55, "assignee": "dev_choi",
        "body": "인트라넷 공지사항 첨부파일 다운로드 클릭 시 404 오류.",
        "close": True,
        "comments": [("dev_choi", "파일 서버 경로 변경으로 인한 URL 깨짐 수정 배포.")]
    },
]

# ════════════════════════════════════════════════════════════════════════════
# 2. 문제(Problem) 데이터
# ════════════════════════════════════════════════════════════════════════════

PROBLEMS = [
    {
        "title": "ERP 시스템 DB 연결 풀 반복 고갈 문제",
        "priority": "critical",
        "days": 2,
        "author": "pl_lee",
        "desc": "ERP 로그인 오류(500) 가 반복적으로 발생하며 근본 원인은 DB 연결 풀 고갈임을 확인.\n"
                "애플리케이션 레벨의 커넥션 누수 또는 커넥션 풀 크기 미설정이 원인으로 추정.",
    },
    {
        "title": "사내 NAS 자동 마운트 해제 현상 반복",
        "priority": "high",
        "days": 10,
        "author": "agent_kim",
        "desc": "NFS 마운트가 서버 재부팅 또는 네트워크 순단 후 자동 복구되지 않는 문제.\n"
                "autofs 또는 systemd 마운트 유닛 설정 검토 필요.",
    },
    {
        "title": "Wi-Fi AP 채널 간섭으로 인한 연결 불안정",
        "priority": "medium",
        "days": 5,
        "author": "agent_park",
        "desc": "3~5층 AP 간 채널 중첩으로 인해 무선 연결 품질이 저하되는 패턴 확인.\n"
                "WLC(무선 컨트롤러)에서 자동 채널 할당 정책 재조정이 필요.",
    },
    {
        "title": "VPN SSL 세션 타임아웃 설정 오류",
        "priority": "high",
        "days": 3,
        "author": "pl_lee",
        "desc": "Fortinet SSL-VPN의 idle-timeout 값이 기본값(30분)으로 설정되어 있어\n"
                "재택 근무자 연결이 반복적으로 끊기는 원인이 됨.",
    },
    {
        "title": "EDR 에이전트 미설치 단말 보안 취약점",
        "priority": "high",
        "days": 15,
        "author": "pl_lee",
        "desc": "최근 피싱 공격 조사 결과 EDR 미설치 단말 23대 발견.\n"
                "BYOD 정책 미적용 단말의 회사 네트워크 접근이 근본 원인.",
    },
    {
        "title": "레거시 서버 패치 관리 프로세스 부재",
        "priority": "critical",
        "days": 65,
        "author": "dev_choi",
        "desc": "CVE 패치 적용 누락이 반복되는 것은 중앙 집중형 패치 관리 솔루션이 없기 때문.\n"
                "WSUS 또는 Ansible 기반 자동 패치 파이프라인 구축 필요.",
    },
]

# ════════════════════════════════════════════════════════════════════════════
# 3. 변경(Change) 요청
# ════════════════════════════════════════════════════════════════════════════

CHANGES = [
    {
        "title": "ERP DB 커넥션 풀 크기 확장 및 누수 패치",
        "type": "normal", "risk": "high",
        "status": "approved",
        "days": 1, "author": "dev_choi",
        "desc": "HikariCP maximumPoolSize 10 → 50 조정 및 커넥션 누수 코드 수정 배포.",
        "start_offset": 2, "end_offset": 2,
    },
    {
        "title": "VPN SSL 세션 타임아웃 8시간으로 변경",
        "type": "standard", "risk": "low",
        "status": "implemented",
        "days": 4, "author": "agent_park",
        "desc": "Fortinet 관리 콘솔에서 idle-timeout 30분 → 480분 변경.",
        "start_offset": 1, "end_offset": 1,
    },
    {
        "title": "전사 MFA 1단계 적용 — 관리자 계정",
        "type": "normal", "risk": "medium",
        "status": "reviewing",
        "days": 6, "author": "pl_lee",
        "desc": "OKTA 연동을 통한 관리자 계정(약 20명) TOTP MFA 적용.\n롤백: OKTA 정책에서 MFA 비활성화.",
        "start_offset": 7, "end_offset": 8,
    },
    {
        "title": "코어 스위치 펌웨어 업그레이드",
        "type": "normal", "risk": "critical",
        "status": "approved",
        "days": 2, "author": "agent_kim",
        "desc": "Cisco Catalyst 9500 코어 스위치 IOS-XE 17.9.4 → 17.12.2 업그레이드.\n"
                "작업 시간: 토요일 새벽 2~4시 (다운타임 예상 약 30분).",
        "start_offset": 5, "end_offset": 5,
    },
    {
        "title": "AWS S3 버킷 퍼블릭 차단 정책 전사 적용",
        "type": "standard", "risk": "low",
        "status": "implemented",
        "days": 32, "author": "dev_choi",
        "desc": "전체 S3 버킷 Block Public Access 설정 활성화 및 SCP 정책 적용.",
        "start_offset": 0, "end_offset": 0,
    },
    {
        "title": "NAS autofs → systemd.mount 마이그레이션",
        "type": "normal", "risk": "medium",
        "status": "submitted",
        "days": 8, "author": "agent_kim",
        "desc": "autofs 대신 systemd automount 유닛으로 전환하여 마운트 안정성 향상.",
        "start_offset": 3, "end_offset": 3,
    },
    {
        "title": "Exchange 최대 첨부파일 크기 50MB 상향",
        "type": "standard", "risk": "low",
        "status": "implemented",
        "days": 52, "author": "agent_park",
        "desc": "Exchange Server 송수신 커넥터 MaxMessageSize 10MB → 50MB 변경.",
        "start_offset": 0, "end_offset": 0,
    },
    {
        "title": "Jenkins CI → GitLab CI/CD 전환",
        "type": "normal", "risk": "medium",
        "status": "draft",
        "days": 5, "author": "dev_song",
        "desc": "레거시 Jenkins 파이프라인을 GitLab CI로 전환. 2개 서비스 우선 적용 후 순차 확대.",
        "start_offset": 14, "end_offset": 20,
    },
]


def main():
    conn = psycopg2.connect(**PG)
    cur  = conn.cursor()

    created_iids: list[int] = []

    # ── 1. 일반 티켓 ──────────────────────────────────────────────────────────
    print(f"\n{'═'*60}")
    print(f"  일반 티켓 {len(TICKETS)}건 생성")
    print(f"{'═'*60}")

    for t in TICKETS:
        author  = t["author"]
        uid     = USERS[author]["id"]
        asgn    = USERS.get(t.get("assignee",""), {})
        asgn_id = asgn.get("id")
        created = days_ago(t["days"]).isoformat()
        u_info  = USERS[author]

        description = (
            f"**신청자:** {u_info['name']}\n"
            f"**부서:** {u_info['dept']}\n"
            f"**이메일:** {author}@itsm.local\n\n"
            f"---\n\n"
            + t["body"]
        )

        payload = {
            "title":       t["title"],
            "description": description,
            "labels":      ",".join(t["labels"]),
            "created_at":  created,
        }
        if asgn_id:
            payload["assignee_id"] = asgn_id

        issue = gl_post(f"/projects/{PROJECT_ID}/issues", payload, sudo=uid)
        if not issue:
            continue

        iid = issue["iid"]
        created_iids.append(iid)

        # 댓글 추가
        for (commenter, body) in t.get("comments", []):
            c_uid = USERS[commenter]["id"]
            comment_time = (days_ago(t["days"] - random.uniform(0.1, 0.5))).isoformat()
            gl_post(
                f"/projects/{PROJECT_ID}/issues/{iid}/notes",
                {"body": body, "created_at": comment_time},
                sudo=c_uid
            )

        # 완료/종결 처리
        if t.get("close"):
            close_issue(iid)

        status_label = [l for l in t["labels"] if l.startswith("status::")][0].replace("status::", "") if any(l.startswith("status::") for l in t["labels"]) else "open"
        print(f"  ✓ #{iid} [{status_label}] {t['title'][:55]}")
        time.sleep(0.1)

    # ── 2. 문제(Problem) 티켓 ─────────────────────────────────────────────────
    print(f"\n{'═'*60}")
    print(f"  문제(Problem) {len(PROBLEMS)}건 생성")
    print(f"{'═'*60}")

    problem_iids: list[int] = []

    for p in PROBLEMS:
        uid     = USERS[p["author"]]["id"]
        created = days_ago(p["days"]).isoformat()

        # NOTE: 'problem'(project label)과 'prio::'(group label) 동시 지정 시
        # GitLab CE 레이블 정렬 버그(NilClass comparison)가 발생하므로 두 단계로 분리
        payload = {
            "title":       p["title"],
            "description": p["desc"],
            "labels":      "problem",
            "created_at":  created,
        }
        issue = gl_post(f"/projects/{PROJECT_ID}/issues", payload, sudo=uid)
        if not issue:
            continue
        # 우선순위 레이블 별도 추가
        gl_put(
            f"/projects/{PROJECT_ID}/issues/{issue['iid']}",
            {"add_labels": f"prio::{p['priority']}"},
            sudo=uid,
        )

        iid = issue["iid"]
        problem_iids.append(iid)
        created_iids.append(iid)

        # DB 등록
        cur.execute(
            """
            INSERT INTO ticket_type_meta (ticket_iid, project_id, ticket_type, created_by, updated_by)
            VALUES (%s, %s, 'problem', %s, %s)
            ON CONFLICT (ticket_iid, project_id) DO UPDATE SET ticket_type='problem'
            """,
            (iid, PROJECT_ID, p["author"], p["author"]),
        )

        print(f"  ✓ #{iid} [problem/{p['priority']}] {p['title'][:55]}")
        time.sleep(0.1)

    conn.commit()

    # ── 인시던트 ↔ 문제 연결 ─────────────────────────────────────────────────
    # 이미 생성된 일반 티켓 iid 중 incident 라벨 포함 티켓을 연결
    incident_tickets = [
        t for t in TICKETS
        if "incident" in t.get("labels", [])
    ]

    # problem_iids 순서대로 첫 2개 인시던트 연결
    link_pairs = [
        # (problem_index, incident_ticket_index_in_TICKETS)
        (0, [0, 10]),   # ERP DB 문제 → 네트워크 다운 + ERP 로그인오류
        (1, [27]),       # NAS 반복 마운트 → 백업 실패
        (2, [2]),        # Wi-Fi AP → 3층 AP 불량
        (3, [1]),        # VPN SSL → VPN 불안정
        (4, [16]),       # EDR 미설치 → 피싱 이메일
        (5, [41]),       # 레거시 패치 → CVE 패치
    ]

    if len(problem_iids) >= 1 and len(created_iids) >= 50:
        print(f"\n  문제-인시던트 연결 설정...")
        for prob_idx, inc_ticket_indices in link_pairs:
            if prob_idx >= len(problem_iids):
                continue
            prob_iid = problem_iids[prob_idx]
            for ti in inc_ticket_indices:
                if ti >= len(created_iids):
                    continue
                inc_iid = created_iids[ti]
                try:
                    cur.execute(
                        """
                        INSERT INTO ticket_links (source_iid, project_id, target_iid, link_type, created_by)
                        VALUES (%s, %s, %s, 'causes', 'root')
                        ON CONFLICT DO NOTHING
                        """,
                        (prob_iid, PROJECT_ID, inc_iid),
                    )
                    print(f"    문제 #{prob_iid} → 인시던트 #{inc_iid}")
                except Exception as e:
                    print(f"    ⚠ 링크 실패: {e}")

    conn.commit()

    # ── 3. 변경(Change) 요청 ─────────────────────────────────────────────────
    print(f"\n{'═'*60}")
    print(f"  변경(Change) 요청 {len(CHANGES)}건 생성")
    print(f"{'═'*60}")

    for c in CHANGES:
        created_dt = days_ago(c["days"])
        start_dt   = NOW + timedelta(days=c["start_offset"])
        end_dt     = NOW + timedelta(days=c["end_offset"], hours=4)

        cur.execute(
            """
            INSERT INTO change_requests
              (title, description, change_type, risk_level, status,
               requester_username, project_id, scheduled_start_at, scheduled_end_at,
               created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                c["title"], c["desc"], c["type"], c["risk"], c["status"],
                c["author"], PROJECT_ID,
                start_dt.replace(tzinfo=None),
                end_dt.replace(tzinfo=None),
                created_dt.replace(tzinfo=None),
                created_dt.replace(tzinfo=None),
            ),
        )
        print(f"  ✓ [{c['status']}/{c['risk']}] {c['title'][:55]}")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n{'═'*60}")
    print(f"  ✅ 완료: 티켓 {len(TICKETS)}건, 문제 {len(PROBLEMS)}건, 변경 {len(CHANGES)}건")
    print(f"{'═'*60}\n")


if __name__ == "__main__":
    main()
