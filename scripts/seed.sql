-- =============================================================================
-- ZENITH ITSM 초기 기본 데이터 시드
-- alembic upgrade head 이후 실행
-- 이미 데이터가 있는 경우 ON CONFLICT DO NOTHING 으로 안전하게 실행됩니다
-- =============================================================================

-- ── 업무 시간 설정 (SLA 계산 기준) ─────────────────────────────────────────
-- 월~금 09:00~18:00, 토·일 비활성화
INSERT INTO business_hours_config (day_of_week, start_time, end_time, is_active) VALUES
    (0, '09:00', '18:00', true),   -- 월요일
    (1, '09:00', '18:00', true),   -- 화요일
    (2, '09:00', '18:00', true),   -- 수요일
    (3, '09:00', '18:00', true),   -- 목요일
    (4, '09:00', '18:00', true),   -- 금요일
    (5, '09:00', '18:00', false),  -- 토요일
    (6, '09:00', '18:00', false)   -- 일요일
ON CONFLICT DO NOTHING;

-- ── 시스템 설정 기본값 ───────────────────────────────────────────────────────
INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES
    ('site_name',            'ZENITH ITSM',  'system', NOW()),
    ('max_attachment_mb',    '20',           'system', NOW()),
    ('session_timeout_min',  '480',          'system', NOW()),
    ('ticket_prefix',        'ITSM',         'system', NOW()),
    ('enable_guest_portal',  'true',         'system', NOW()),
    ('enable_kb_public',     'false',        'system', NOW())
ON CONFLICT (key) DO NOTHING;

-- ── 빠른 답변(Quick Reply) 기본 템플릿 ─────────────────────────────────────
INSERT INTO quick_replies (name, content, category, created_by, created_at) VALUES
    (
        '접수 확인',
        '안녕하세요. 티켓이 정상적으로 접수되었습니다. 담당자가 배정되면 별도로 안내드리겠습니다. 감사합니다.',
        '일반',
        'system',
        NOW()
    ),
    (
        '처리 시작 안내',
        '담당자가 배정되어 처리를 시작하였습니다. 진행 상황은 포털에서 확인하실 수 있습니다.',
        '일반',
        'system',
        NOW()
    ),
    (
        '추가 정보 요청',
        '원활한 처리를 위해 아래 정보를 추가로 제공해 주시겠습니까?\n\n- 발생 일시:\n- 증상 설명:\n- 스크린샷 또는 로그 첨부 (가능한 경우)',
        '일반',
        'system',
        NOW()
    ),
    (
        '해결 완료 안내',
        '요청하신 사항이 처리 완료되었습니다. 추가 문의 사항이 있으시면 새 티켓을 등록해 주세요. 감사합니다.',
        '일반',
        'system',
        NOW()
    ),
    (
        '하드웨어 교체 안내',
        '장비 교체 요청이 접수되었습니다. IT 팀에서 재고를 확인한 후 교체 일정을 안내드리겠습니다.',
        '하드웨어',
        'system',
        NOW()
    ),
    (
        '비밀번호 초기화 안내',
        '비밀번호 초기화가 완료되었습니다. 임시 비밀번호를 안내드리오니 반드시 로그인 후 변경해 주세요.',
        '계정',
        'system',
        NOW()
    ),
    (
        '중복 티켓 안내',
        '해당 요청은 이미 처리 중인 티켓(#TICKET_ID)과 동일한 사안으로 확인됩니다. 해당 티켓으로 통합하여 처리하겠습니다.',
        '일반',
        'system',
        NOW()
    )
ON CONFLICT DO NOTHING;

-- ── 현재 연도 공휴일 관리 탭 활성화 ─────────────────────────────────────────
INSERT INTO holiday_years (year, created_at)
    VALUES (EXTRACT(YEAR FROM NOW())::int, NOW())
ON CONFLICT DO NOTHING;

-- ── 서비스 카탈로그 기본 항목 (이미 있으면 건너뜀) ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM service_catalog_items LIMIT 1) THEN
    INSERT INTO service_catalog_items (name, description, category, icon, fields_schema, is_active, "order", created_by, created_at, updated_at) VALUES
      ('PC/노트북 교체 신청', 'PC, 노트북 등 개인 업무용 단말기 교체를 신청합니다.', '하드웨어', '💻',
       '[{"name":"device_type","label":"장비 유형","type":"select","options":["PC","노트북","모니터","기타"],"required":true},{"name":"reason","label":"교체 사유","type":"text","required":true}]',
       true, 10, 'system', NOW(), NOW()),
      ('소프트웨어 설치 요청', '업무에 필요한 소프트웨어 설치를 요청합니다.', '소프트웨어', '📦',
       '[{"name":"software_name","label":"소프트웨어명","type":"text","required":true},{"name":"version","label":"버전","type":"text","required":false},{"name":"license_type","label":"라이선스 유형","type":"select","options":["사내 라이선스","개인 구매","오픈소스"],"required":true}]',
       true, 20, 'system', NOW(), NOW()),
      ('계정/권한 신청', '시스템 계정 생성 또는 권한 변경을 요청합니다.', '계정', '👤',
       '[{"name":"system_name","label":"대상 시스템","type":"text","required":true},{"name":"request_type","label":"요청 유형","type":"select","options":["계정 생성","권한 추가","권한 회수","계정 잠금 해제"],"required":true}]',
       true, 30, 'system', NOW(), NOW()),
      ('네트워크 접근 요청', '특정 네트워크 또는 포트 접근 권한을 요청합니다.', '네트워크', '🌐',
       '[{"name":"target_host","label":"대상 호스트/IP","type":"text","required":true},{"name":"port","label":"포트","type":"text","required":false},{"name":"reason","label":"요청 사유","type":"text","required":true}]',
       true, 40, 'system', NOW(), NOW());
    RAISE NOTICE '서비스 카탈로그 4건 삽입';
  ELSE
    RAISE NOTICE '서비스 카탈로그 이미 존재 — 건너뜀';
  END IF;
END $$;

-- ── SLA 정책 (우선순위별 응답·해결 목표 시간) ──────────────────────────────
INSERT INTO sla_policies (priority, response_hours, resolve_hours) VALUES
    ('critical',  4,    8),
    ('high',      8,   24),
    ('medium',   24,   72),
    ('low',      48,  168)
ON CONFLICT DO NOTHING;

-- ── 서비스 유형 (카테고리) ──────────────────────────────────────────────────
INSERT INTO service_types (value, label, description, emoji, enabled) VALUES
    ('1', '하드웨어',   'hardware', '🖥️', true),
    ('2', '소프트웨어', 'software', '💻', true),
    ('3', '네트워크',   'network',  '🌐', true),
    ('4', '계정/권한',  'account',  '👤', true),
    ('5', '기타',       'other',    '📋', true)
ON CONFLICT DO NOTHING;

-- ── 티켓 템플릿 (자주 사용하는 양식) ────────────────────────────────────────
INSERT INTO ticket_templates (name, category, description, created_by, created_at) VALUES
    ('PC 고장 / 부품 교체 요청', 'hardware',
     E'## 증상 설명\n(어떤 증상이 발생했는지 구체적으로 작성해 주세요)\n\n## 장비 정보\n- 장비명/모델:\n- 자산 태그 번호:\n- 위치(층수/좌석):\n\n## 발생 시각\n- 최초 발생일시:\n\n## 현재까지 시도한 조치\n(재부팅, 케이블 재연결 등 직접 시도한 내용)\n\n## 업무 영향도\n- 해당 장비 없이 업무 가능 여부: [ ] 가능  [ ] 불가능',
     'system', NOW()),
    ('프린터 오류 신고', 'hardware',
     E'## 오류 증상\n- [ ] 인쇄 불가\n- [ ] 용지 걸림\n- [ ] 네트워크 인식 안 됨\n- [ ] 인쇄 품질 불량\n- [ ] 기타:\n\n## 프린터 정보\n- 위치(층수):\n- 프린터명:\n\n## 오류 메시지\n(화면에 표시된 오류 메시지가 있다면 작성)\n\n## 현재까지 시도한 조치',
     'system', NOW()),
    ('소프트웨어 설치 / 업그레이드 요청', 'software',
     E'## 요청 소프트웨어\n- 소프트웨어명:\n- 버전:\n- 용도/사용 목적:\n\n## 설치 대상 PC\n- 자산 태그 번호:\n- 사용자 이름:\n- 위치(층수/좌석):\n\n## 라이선스 정보\n- [ ] 회사 보유 라이선스 사용\n- [ ] 신규 구매 필요 (예상 비용: )\n- [ ] 무료/오픈소스\n\n## 요청 사유\n\n## 희망 처리 기한',
     'system', NOW()),
    ('소프트웨어 오류 신고', 'software',
     E'## 오류 발생 소프트웨어\n- 소프트웨어명 및 버전:\n- 운영체제:\n\n## 오류 증상\n(언제, 어떤 상황에서 오류가 발생하는지 구체적으로)\n\n## 오류 메시지\n(화면 캡처 또는 오류 메시지 전문)\n\n## 재현 방법\n1.\n2.\n3.\n\n## 현재까지 시도한 조치\n\n## 업무 영향도',
     'system', NOW()),
    ('네트워크 / 인터넷 장애 신고', 'network',
     E'## 증상\n- [ ] 인터넷 전체 불통\n- [ ] 특정 사이트/서비스만 접속 불가\n- [ ] 속도 저하\n- [ ] VPN 연결 불가\n- [ ] 기타:\n\n## 영향 범위\n- [ ] 본인 PC만\n- [ ] 특정 구역 전체 (위치: )\n- [ ] 전사 전체\n\n## 발생 시각\n- 최초 발생일시:\n\n## 현재까지 시도한 조치\n(공유기 재부팅, LAN 케이블 재연결 등)',
     'system', NOW()),
    ('VPN 접속 오류 신고', 'network',
     E'## 오류 증상\n- [ ] VPN 클라이언트 실행 안 됨\n- [ ] 서버 연결 실패\n- [ ] 인증 오류\n- [ ] 연결 후 내부망 접속 불가\n- [ ] 연결 후 자주 끊김\n\n## 사용 환경\n- 운영체제:\n- VPN 클라이언트 버전:\n- 접속 위치: [ ] 재택  [ ] 외부  [ ] 기타\n\n## 오류 메시지\n\n## 최근 변경 사항\n(PC 교체, OS 업데이트, 비밀번호 변경 등)',
     'system', NOW()),
    ('계정 생성 / 권한 부여 요청', 'account',
     E'## 요청 유형\n- [ ] 신규 계정 생성\n- [ ] 기존 계정 권한 추가\n- [ ] 기존 계정 권한 변경\n\n## 대상자 정보\n- 성명:\n- 부서:\n- 직책:\n- 입사일 (신규의 경우):\n\n## 요청 시스템 및 권한\n| 시스템 | 요청 권한 수준 | 사유 |\n|---|---|---|\n|  |  |  |\n\n## 결재 승인\n- 부서장 승인 여부: [ ] 승인완료  [ ] 승인 예정\n\n## 희망 처리 기한',
     'system', NOW()),
    ('계정 잠금 해제 요청', 'account',
     E'## 잠금된 계정 정보\n- 사용자 계정(ID):\n- 성명:\n- 부서:\n\n## 잠금 발생 시각\n\n## 잠금 원인 (알고 있는 경우)\n- [ ] 비밀번호 오입력 반복\n- [ ] 장기 미사용\n- [ ] 기타:\n\n## 본인 확인 방법\n(임직원증 번호, 사원번호 등)',
     'system', NOW()),
    ('인프라 변경 요청', 'other',
     E'## 변경 요약\n(한 줄로 변경 내용을 요약)\n\n## 변경 유형\n- [ ] 긴급 변경\n- [ ] 표준 변경\n- [ ] 일반 변경\n\n## 변경 상세 내용\n(변경 대상 시스템, 변경 내용, 변경 이유)\n\n## 변경 위험도\n- [ ] 낮음  [ ] 보통  [ ] 높음  [ ] 매우 높음\n\n## 작업 예정 일시\n- 시작:\n- 종료:\n\n## 영향 범위 및 다운타임\n\n## 롤백 계획\n(변경 실패 시 원복 방법)\n\n## 테스트 계획',
     'system', NOW())
ON CONFLICT DO NOTHING;

-- ── 완료 메시지 ───────────────────────────────────────────────────────────────
DO $$
BEGIN
    RAISE NOTICE '✅ ZENITH ITSM 초기 데이터 시드 완료';
END $$;
