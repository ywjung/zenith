"""ZENITH ITSM 테스트 사용자 및 샘플 티켓 시드 스크립트."""
import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone

import psycopg2
import requests

# ── 연결 설정 ─────────────────────────────────────────────────────────────────
GITLAB_URL = "http://gitlab:8929"
GITLAB_TOKEN = "glpat-moCp2tCHyFJhFlUKENypnm86MQp1OjEH.01.0w1o77nex"
GITLAB_GROUP_ID = 2
GITLAB_PROJECT_ID = 1

PG = dict(host="postgres", port=5432, dbname="itsm", user="itsm", password="change_me_secure_password")

HEADERS = {"PRIVATE-TOKEN": GITLAB_TOKEN, "Content-Type": "application/json"}

# ── 생성할 사용자 목록 ──────────────────────────────────────────────────────────
USERS = [
    dict(username="agent_kim",  name="김민지", email="agent_kim@itsm.local",  gl_level=40, itsm_role="agent"),
    dict(username="agent_park", name="박서준", email="agent_park@itsm.local", gl_level=40, itsm_role="agent"),
    dict(username="pl_lee",     name="이지현", email="pl_lee@itsm.local",     gl_level=40, itsm_role="pl"),
    dict(username="dev_choi",   name="최우진", email="dev_choi@itsm.local",   gl_level=30, itsm_role="developer"),
    dict(username="dev_song",   name="송예린", email="dev_song@itsm.local",   gl_level=30, itsm_role="developer"),
    dict(username="user_han",   name="한수빈", email="user_han@itsm.local",   gl_level=20, itsm_role="user"),
    dict(username="user_jung",  name="정다은", email="user_jung@itsm.local",  gl_level=20, itsm_role="user"),
    dict(username="user_oh",    name="오승현", email="user_oh@itsm.local",    gl_level=20, itsm_role="user"),
]

# ── 샘플 티켓 ────────────────────────────────────────────────────────────────
TICKETS = [
    dict(
        title="[긴급] 서버 다운으로 업무 전체 중단",
        labels=["status::open", "prio::critical", "cat::네트워크", "incident"],
        author="user_han", employee_name="한수빈", email="user_han@itsm.local", dept="개발팀",
        body="<p>오전 9시부터 메인 서버에 접근이 불가능합니다.</p><p>전체 개발팀 업무가 중단된 상태입니다. 즉각적인 조치를 부탁드립니다.</p>",
        days_ago=1,
    ),
    dict(
        title="노트북 배터리 교체 요청",
        labels=["status::open", "prio::medium", "cat::하드웨어", "service_request"],
        author="user_jung", employee_name="정다은", email="user_jung@itsm.local", dept="마케팅팀",
        body="<p>노트북 배터리 수명이 다해 충전이 되지 않습니다.</p><p>모델: Dell XPS 15, 시리얼: DX15-2023-001</p>",
        days_ago=3,
    ),
    dict(
        title="MS Office 라이선스 추가 요청",
        labels=["status::in_progress", "prio::medium", "cat::소프트웨어", "service_request"],
        author="user_oh", employee_name="오승현", email="user_oh@itsm.local", dept="경영지원팀",
        body="<p>신규 입사자 3명을 위한 MS Office 365 라이선스가 필요합니다.</p><ul><li>입사자 A (개발팀)</li><li>입사자 B (영업팀)</li><li>입사자 C (마케팅팀)</li></ul>",
        days_ago=5,
    ),
    dict(
        title="VPN 접속 오류 - 재택근무 불가",
        labels=["status::open", "prio::high", "cat::네트워크", "incident"],
        author="user_han", employee_name="한수빈", email="user_han@itsm.local", dept="개발팀",
        body="<p>자택에서 VPN 접속 시 <strong>'인증 실패'</strong> 오류가 발생합니다.</p><p>오류코드: VPN-AUTH-4031</p><p>사내 접속 시에는 정상 동작합니다.</p>",
        days_ago=2,
    ),
    dict(
        title="프린터 연결 끊김 (3층 복합기)",
        labels=["status::resolved", "prio::low", "cat::하드웨어", "service_request"],
        author="user_jung", employee_name="정다은", email="user_jung@itsm.local", dept="마케팅팀",
        body="<p>3층 공용 복합기가 네트워크에서 사라졌습니다.</p><p>복합기 모델: Canon imageRUNNER 2630i</p><p>IP: 192.168.1.100</p>",
        days_ago=10,
    ),
    dict(
        title="랜섬웨어 의심 파일 발견",
        labels=["status::in_progress", "prio::critical", "cat::보안", "incident"],
        author="user_oh", employee_name="오승현", email="user_oh@itsm.local", dept="경영지원팀",
        body="<p>이메일 첨부파일 실행 후 파일 확장자가 <strong>.encrypted</strong>로 변경되고 있습니다.</p><p>현재 해당 PC를 네트워크에서 분리한 상태입니다. 즉시 조치 요청합니다.</p>",
        days_ago=1,
    ),
    dict(
        title="신규 입사자 계정 생성 요청",
        labels=["status::closed", "prio::medium", "cat::계정관리", "service_request"],
        author="user_han", employee_name="한수빈", email="user_han@itsm.local", dept="개발팀",
        body="<p>4월 1일 입사 예정인 신규 직원 계정 생성을 요청합니다.</p><ul><li>이름: 김철수</li><li>부서: 영업팀</li><li>직급: 대리</li></ul>",
        days_ago=15,
    ),
    dict(
        title="인터넷 속도 저하 문의",
        labels=["status::waiting", "prio::medium", "cat::네트워크", "incident"],
        author="user_jung", employee_name="정다은", email="user_jung@itsm.local", dept="마케팅팀",
        body="<p>오후 2시부터 인터넷 속도가 매우 느립니다.</p><p>평소 100Mbps → 현재 측정값 2Mbps</p><p>대용량 파일 업로드가 불가능한 수준입니다.</p>",
        days_ago=4,
    ),
    dict(
        title="업무용 소프트웨어 설치 요청 (Adobe CC)",
        labels=["status::open", "prio::medium", "cat::소프트웨어", "service_request"],
        author="user_oh", employee_name="오승현", email="user_oh@itsm.local", dept="경영지원팀",
        body="<p>디자인 작업을 위해 Adobe Creative Cloud 구독이 필요합니다.</p><p>필요 프로그램: Photoshop, Illustrator, InDesign</p><p>업무 목적: 사내 홍보물 및 마케팅 자료 제작</p>",
        days_ago=7,
    ),
    dict(
        title="모니터 화면 깜빡임 현상",
        labels=["status::in_progress", "prio::low", "cat::하드웨어", "service_request"],
        author="user_han", employee_name="한수빈", email="user_han@itsm.local", dept="개발팀",
        body="<p>외부 모니터(27인치 Dell U2722D) 화면이 약 30분마다 한 번씩 깜빡입니다.</p><p>시도한 조치:</p><ul><li>HDMI 케이블 교체 → 증상 지속</li><li>DisplayPort 케이블로 변경 → 증상 지속</li></ul>",
        days_ago=6,
    ),
    dict(
        title="비밀번호 분실 - 사내 ERP 접속 불가",
        labels=["status::closed", "prio::high", "cat::계정관리", "service_request"],
        author="user_jung", employee_name="정다은", email="user_jung@itsm.local", dept="마케팅팀",
        body="<p>ERP 시스템(SAP) 비밀번호를 분실하여 접속이 불가능합니다.</p><p>사원번호: MK-2019-042</p><p>최근 비밀번호 변경일: 90일 전 (만료됨)</p>",
        days_ago=20,
    ),
    dict(
        title="공유 드라이브 용량 부족 알림",
        labels=["status::open", "prio::medium", "cat::스토리지", "service_request"],
        author="user_oh", employee_name="오승현", email="user_oh@itsm.local", dept="경영지원팀",
        body="<p>팀 공유 드라이브(\\\\fileserver\\mgmt)가 <strong>98% 사용 중</strong>입니다.</p><p>현재 용량: 980GB / 1TB</p><p>추가 용량 할당 또는 정리 지원을 요청합니다.</p>",
        days_ago=2,
    ),
    dict(
        title="업무용 스마트폰 분실 신고 및 원격 초기화 요청",
        labels=["status::resolved", "prio::critical", "cat::보안", "incident"],
        author="user_han", employee_name="한수빈", email="user_han@itsm.local", dept="개발팀",
        body="<p>어제 퇴근길에 업무용 스마트폰(iPhone 14 Pro)을 분실했습니다.</p><p>기기 정보:</p><ul><li>MDM 등록번호: MDM-2023-0412</li><li>IMEI: 351234567890123</li></ul><p>원격 초기화 및 MDM 잠금 처리를 즉시 요청합니다.</p>",
        days_ago=8,
    ),
    dict(
        title="화상회의 프로그램(Zoom) 실행 오류",
        labels=["status::resolved", "prio::medium", "cat::소프트웨어", "incident"],
        author="user_jung", employee_name="정다은", email="user_jung@itsm.local", dept="마케팅팀",
        body="<p>Zoom 실행 시 <strong>'오디오 드라이버를 찾을 수 없습니다'</strong> 오류가 발생합니다.</p><p>시도한 조치: 재설치 2회 → 동일 증상</p><p>OS: Windows 11 Pro, Zoom 버전: 5.17.1</p>",
        days_ago=12,
    ),
    dict(
        title="외부 방문자용 게스트 Wi-Fi 비밀번호 변경 요청",
        labels=["status::open", "prio::low", "cat::네트워크", "service_request"],
        author="user_oh", employee_name="오승현", email="user_oh@itsm.local", dept="경영지원팀",
        body="<p>이번 주 외부 파트너사 방문 일정이 있어 게스트 Wi-Fi 접속 정보가 필요합니다.</p><p>현재 비밀번호는 1년 이상 변경되지 않아 보안 우려가 있습니다.</p><p>방문 일정: 4월 5일(금) 오전 10시 ~ 오후 5시</p>",
        days_ago=1,
    ),
]


def gl(method, path, **kwargs):
    url = f"{GITLAB_URL}/api/v4{path}"
    r = getattr(requests, method)(url, headers=HEADERS, timeout=15, **kwargs)
    return r


def ok(r, label=""):
    if r.status_code not in (200, 201):
        print(f"  ⚠  {label} {r.status_code}: {r.text[:200]}")
        return False
    return True


# ── 1. GitLab 사용자 생성 ──────────────────────────────────────────────────────
print("\n=== 1. GitLab 사용자 생성 ===")
existing = {u["username"]: u["id"] for u in gl("get", "/users", params={"per_page": 100}).json()}
user_id_map = dict(existing)

for u in USERS:
    uname = u["username"]
    if uname in existing:
        print(f"  ✓ {uname} 이미 존재 (id={existing[uname]})")
        continue
    r = requests.post(
        f"{GITLAB_URL}/api/v4/users",
        headers={"PRIVATE-TOKEN": GITLAB_TOKEN},
        data={
            "username": uname,
            "name": u["name"],
            "email": u["email"],
            "password": "xK9mP2vL7nQ4Rw",
            "skip_confirmation": "true",
            "can_create_group": "false",
        },
        timeout=15,
    )
    if ok(r, f"사용자 생성 {uname}"):
        uid = r.json()["id"]
        user_id_map[uname] = uid
        print(f"  ✓ {uname} ({u['name']}) 생성 완료 (id={uid})")
    else:
        user_id_map[uname] = None

# ── 2. 그룹/프로젝트 멤버 추가 ──────────────────────────────────────────────────
print("\n=== 2. GitLab 그룹/프로젝트 멤버 추가 ===")
for u in USERS:
    uid = user_id_map.get(u["username"])
    if not uid:
        continue
    # 그룹 멤버
    r = gl("post", f"/groups/{GITLAB_GROUP_ID}/members",
           json={"user_id": uid, "access_level": u["gl_level"]})
    if r.status_code in (200, 201):
        print(f"  ✓ {u['username']} → 그룹 추가 (level={u['gl_level']})")
    elif r.status_code == 409:
        print(f"  ✓ {u['username']} → 그룹 이미 멤버")
    else:
        print(f"  ⚠ {u['username']} 그룹 추가 실패: {r.text[:100]}")

    # 프로젝트 멤버
    r = gl("post", f"/projects/{GITLAB_PROJECT_ID}/members",
           json={"user_id": uid, "access_level": u["gl_level"]})
    if r.status_code in (200, 201):
        print(f"  ✓ {u['username']} → 프로젝트 추가")
    elif r.status_code == 409:
        print(f"  ✓ {u['username']} → 프로젝트 이미 멤버")

# ── 3. ITSM 역할 등록 (PostgreSQL) ────────────────────────────────────────────
print("\n=== 3. ITSM 역할 등록 ===")
conn = psycopg2.connect(**PG)
cur = conn.cursor()

for u in USERS:
    uid = user_id_map.get(u["username"])
    if not uid:
        continue
    cur.execute("""
        INSERT INTO user_roles (gitlab_user_id, username, role, name, is_active, created_at, updated_at)
        VALUES (%s, %s, %s, %s, true, NOW(), NOW())
        ON CONFLICT (gitlab_user_id) DO UPDATE
          SET role=EXCLUDED.role, name=EXCLUDED.name, username=EXCLUDED.username, is_active=true, updated_at=NOW()
    """, (uid, u["username"], u["itsm_role"], u["name"]))
    print(f"  ✓ {u['username']} ({u['name']}) → 역할: {u['itsm_role']}")

conn.commit()

# ── 4. 샘플 티켓 생성 ──────────────────────────────────────────────────────────
print("\n=== 4. 샘플 티켓 생성 ===")
now = datetime.now(timezone.utc)

for t in TICKETS:
    author_id = user_id_map.get(t["author"])
    created_at = (now - timedelta(days=t["days_ago"],
                                  hours=random.randint(0, 8),
                                  minutes=random.randint(0, 59))).isoformat()

    description = (
        f"**신청자:** {t['employee_name']}\n"
        f"**이메일:** {t['email']}\n"
        f"**부서:** {t['dept']}\n"
        f"**작성자:** {t['author']}\n\n"
        f"---\n\n"
        f"{t['body']}"
    )

    payload = {
        "title": t["title"],
        "description": description,
        "labels": ",".join(t["labels"]),
        "created_at": created_at,
    }
    if author_id:
        payload["author_id"] = author_id  # sudo로 대신 생성하려면 sudo param 필요
        # sudo 헤더로 작성자 지정
        sudo_headers = dict(HEADERS)
        sudo_headers["Sudo"] = str(author_id)
        r = requests.post(
            f"{GITLAB_URL}/api/v4/projects/{GITLAB_PROJECT_ID}/issues",
            headers=sudo_headers,
            json=payload,
            timeout=15,
        )
    else:
        r = gl("post", f"/projects/{GITLAB_PROJECT_ID}/issues", json=payload)

    if ok(r, "티켓 생성"):
        iid = r.json()["iid"]
        print(f"  ✓ #{iid} {t['title'][:50]}")

        # closed 상태면 이슈 닫기
        if "status::closed" in t["labels"] or "status::resolved" in t["labels"]:
            state_event = "close"
            gl("put", f"/projects/{GITLAB_PROJECT_ID}/issues/{iid}",
               json={"state_event": state_event})
    time.sleep(0.1)

conn.close()
print("\n✅ 시드 완료!")
