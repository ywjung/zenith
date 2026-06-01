"""E2E 테스트용 admin 토큰 생성 + Redis JTI 등록.

CI(e2e 워크플로)에서 호출한다. 토큰을 stdout으로 출력하므로
  TOKEN=$(python3 scripts/gen_e2e_token.py)
형태로 사용한다.

(이전에는 워크플로 YAML의 `run: |` 블록에 파이썬을 인라인으로 넣었는데,
파이썬 최상위 문은 들여쓰기가 불가능한 반면 YAML 블록 스칼라는 들여쓰기를
요구해 파싱이 깨졌다. 스크립트 파일로 분리해 해소.)
"""
import base64
import json
import time

from app.auth import create_token, store_gitlab_token


def main() -> None:
    user = {
        "id": 1,
        "username": "e2e_admin",
        "name": "E2E Admin",
        "email": "e2e@test.com",
        "avatar_url": None,
        "organization": "",
    }
    token = create_token(user, gitlab_token="e2e_fake_gitlab_token", role="admin")

    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (4 - len(payload_b64) % 4)
    payload = json.loads(base64.b64decode(payload_b64))

    ttl = payload["exp"] - int(time.time())
    store_gitlab_token(payload["jti"], "e2e_fake_gitlab_token", ttl)

    print(token)


if __name__ == "__main__":
    main()
