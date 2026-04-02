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

-- ── 서비스 카탈로그 기본 항목 ────────────────────────────────────────────────
INSERT INTO service_catalog_items (name, description, category, icon, fields_schema, is_active, "order", created_by, created_at, updated_at) VALUES
    (
        'PC/노트북 교체 신청',
        'PC, 노트북 등 개인 업무용 단말기 교체를 신청합니다.',
        '하드웨어',
        '💻',
        '[{"name":"device_type","label":"장비 유형","type":"select","options":["PC","노트북","모니터","기타"],"required":true},{"name":"reason","label":"교체 사유","type":"text","required":true}]',
        true, 10, 'system', NOW(), NOW()
    ),
    (
        '소프트웨어 설치 요청',
        '업무에 필요한 소프트웨어 설치를 요청합니다.',
        '소프트웨어',
        '📦',
        '[{"name":"software_name","label":"소프트웨어명","type":"text","required":true},{"name":"version","label":"버전","type":"text","required":false},{"name":"license_type","label":"라이선스 유형","type":"select","options":["사내 라이선스","개인 구매","오픈소스"],"required":true}]',
        true, 20, 'system', NOW(), NOW()
    ),
    (
        '계정/권한 신청',
        '시스템 계정 생성 또는 권한 변경을 요청합니다.',
        '계정',
        '👤',
        '[{"name":"system_name","label":"대상 시스템","type":"text","required":true},{"name":"request_type","label":"요청 유형","type":"select","options":["계정 생성","권한 추가","권한 회수","계정 잠금 해제"],"required":true}]',
        true, 30, 'system', NOW(), NOW()
    ),
    (
        '네트워크 접근 요청',
        '특정 네트워크 또는 포트 접근 권한을 요청합니다.',
        '네트워크',
        '🌐',
        '[{"name":"target_host","label":"대상 호스트/IP","type":"text","required":true},{"name":"port","label":"포트","type":"text","required":false},{"name":"reason","label":"요청 사유","type":"text","required":true}]',
        true, 40, 'system', NOW(), NOW()
    )
ON CONFLICT DO NOTHING;

-- ── 완료 메시지 ───────────────────────────────────────────────────────────────
DO $$
BEGIN
    RAISE NOTICE '✅ ZENITH ITSM 초기 데이터 시드 완료';
END $$;
