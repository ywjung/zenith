import os
import sys

# Add project root to path so we can import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, timezone
import httpx
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import UserRole
from app.config import get_settings

settings = get_settings()

def get_headers():
    return {"PRIVATE-TOKEN": settings.GITLAB_ADMIN_TOKEN, "Content-Type": "application/json"}

base_url = f"{settings.GITLAB_API_URL}/api/v4"
pid = settings.GITLAB_PROJECT_ID

def create_gitlab_user(username, name, email, password):
    print(f"Creating GitLab user {username}...")
    with httpx.Client() as c:
        resp = c.post(
            f"{base_url}/users",
            headers=get_headers(),
            json={
                "name": name,
                "username": username,
                "email": email,
                "password": password,
                "password_authentication_enabled_for_web": True,
                "skip_confirmation": True
            }
        )
        if resp.status_code == 201:
            user = resp.json()
            print(f"Created: {user['id']}")
            return user
        elif resp.status_code == 400 and "already exists" in resp.text:
            print("User already exists, fetching ID...")
            resp = c.get(f"{base_url}/users", headers=get_headers(), params={"username": username})
            users = resp.json()
            if users:
                return users[0]
            return None
        else:
            print("Failed to create user:", resp.text)
            return None

def add_project_member(user_id, access_level):
    with httpx.Client() as c:
        resp = c.post(
            f"{base_url}/projects/{pid}/members",
            headers=get_headers(),
            json={"user_id": user_id, "access_level": access_level}
        )
        if resp.status_code in (201, 409):
            print(f"Added member {user_id} to project (or already exists)")

def set_db_role(db, gl_user_id, username, role):
    user_role = db.query(UserRole).filter_by(gitlab_user_id=gl_user_id).first()
    if not user_role:
        user_role = UserRole(gitlab_user_id=gl_user_id, username=username, role=role)
        db.add(user_role)
    else:
        user_role.role = role
    db.commit()

def create_issue(title, desc_dict, labels):
    from app.gitlab_client import create_issue as gl_create
    desc_lines = []
    if "employee_name" in desc_dict:
        desc_lines.append(f"**신청자:** {desc_dict['employee_name']}")
    if "employee_email" in desc_dict:
        desc_lines.append(f"**이메일:** {desc_dict['employee_email']}")
    if "department" in desc_dict:
        desc_lines.append(f"**부서:** {desc_dict['department']}")
    if "created_by_username" in desc_dict:
        desc_lines.append(f"**작성자:** {desc_dict['created_by_username']}")
    desc_lines.extend(["", "---", "", desc_dict.get('body', '')])
    
    desc_text = "\n".join(desc_lines)
    
    return gl_create(title, desc_text, labels)

def main():
    db = SessionLocal()
    
    # 1. Create New Users
    users_to_create = [
        # Field users
        {"username": "user01", "name": "현업사용자1", "email": "user01@example.com", "role": "user", "gl_access": 10}, # Guest
        {"username": "user02", "name": "현업사용자2", "email": "user02@example.com", "role": "user", "gl_access": 10}, # Guest
        
        # IT users
        {"username": "dev02", "name": "IT개발자2", "email": "dev02@example.com", "role": "developer", "gl_access": 30}, # Developer
        {"username": "dev03", "name": "IT개발자3", "email": "dev03@example.com", "role": "developer", "gl_access": 30}, # Developer
        {"username": "admin02", "name": "IT관리자2", "email": "admin02@example.com", "role": "admin", "gl_access": 40}, # Maintainer
    ]
    
    user_info = {}
    
    for u in users_to_create:
        gl_user = create_gitlab_user(u["username"], u["name"], u["email"], "itsmPassword123!")
        if gl_user:
            uid = gl_user["id"]
            user_info[u["username"]] = gl_user
            add_project_member(uid, u["gl_access"])
            set_db_role(db, uid, u["username"], u["role"])
            print(f"Setup complete for {u['username']}")

    # 2. Create sample development requests for user01 & user02
    print("Creating sample development requests...")
    
    from app import sla as sla_module
    
    # Sample for user01 (Development related)
    t1 = create_issue(
        title="CRM 시스템 고객 검색 화면 로딩 최적화 요청",
        desc_dict={
            "employee_name": "현업사용자1",
            "employee_email": "user01@example.com",
            "department": "영업팀",
            "created_by_username": "user01",
            "body": "고객 검색 시 데이터가 많아지면서 로딩이 10초 이상 지연되는 현상이 발생하고 있습니다.\n\n페이징 처리 또는 인덱스 최적화를 통해 로딩 속도를 개선해주시면 감사하겠습니다.\n\n특히 월말 마감 시즌에 불편함이 큽니다."
        },
        labels=["cat::software", "prio::high", "status::open"]
    )
    sla_module.create_sla_record(db, t1["iid"], pid, "high")
    print(f"Created ticket #{t1['iid']} for user01")

    # Samples for user02
    t2 = create_issue(
        title="사내 그룹웨어 신규 결재 양식 추가",
        desc_dict={
            "employee_name": "현업사용자2",
            "employee_email": "user02@example.com",
            "department": "인사총무팀",
            "created_by_username": "user02",
            "body": "이번 달부터 시행되는 재택근무 규정에 맞춰 신규 결재 양식 템플릿(재택근무신청서) 추가를 요청드립니다.\n\n양식 초안과 필수 결재선 정보는 첨부파일로 전달할 예정입니다."
        },
        labels=["cat::software", "prio::medium", "status::open"]
    )
    sla_module.create_sla_record(db, t2["iid"], pid, "medium")
    print(f"Created ticket #{t2['iid']} for user02")
    
    t3 = create_issue(
        title="ERP 시스템 엑셀 다운로드 오류 수정",
        desc_dict={
            "employee_name": "현업사용자2",
            "employee_email": "user02@example.com",
            "department": "재무팀",
            "created_by_username": "user02",
            "body": "특정 데이터(코드에 특수문자가 포함된 경우)를 엑셀로 다운로드할 때 500 오류가 발생합니다.\n\n오류가 발생하는 화면은 [회계관리]-[전표조회] 화면입니다. 빠른 수정 부탁드립니다."
        },
        labels=["cat::software", "prio::high", "status::open"]
    )
    sla_module.create_sla_record(db, t3["iid"], pid, "high")
    print(f"Created ticket #{t3['iid']} for user02")

    print("All tasks completed.")

if __name__ == "__main__":
    main()
