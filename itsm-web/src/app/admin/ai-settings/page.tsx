'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  fetchAISettings, updateAISettings, testAIConnection, fetchOllamaModels,
  fetchOpenAIOAuthClientCredentials, disconnectOpenAIOAuth,
  type AISettingsData, type OllamaModel,
} from '@/lib/api'

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (빠름·저렴)' },
  { value: 'gpt-4o', label: 'GPT-4o (고품질)' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
]

export default function AISettingsPage() {
  const [settings, setSettings] = useState<AISettingsData | null>(null)
  const searchParams = useSearchParams()

  const [form, setForm] = useState({
    enabled: false,
    provider: 'ollama',
    openai_api_key: '',        // '' = 변경 없음
    openai_model: 'gpt-4o-mini',
    ollama_base_url: 'http://host.docker.internal:11434',
    ollama_model: 'llama3.2',
    feature_classify: true,
    feature_summarize: true,
    feature_kb_suggest: true,
    // OAuth
    openai_auth_method: 'api_key',
    openai_oauth_client_id: '',
    openai_oauth_client_secret: '',
    openai_oauth_auth_url: '',
    openai_oauth_token_url: '',
    openai_oauth_scope: 'openid',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [oauthWorking, setOauthWorking] = useState(false)

  // Ollama 모델 목록 조회
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [ollamaFetching, setOllamaFetching] = useState(false)
  const [ollamaFetchError, setOllamaFetchError] = useState<string | null>(null)
  const [ollamaFetched, setOllamaFetched] = useState(false)

  useEffect(() => {
    // OAuth 콜백 결과 처리
    const oauthResult = searchParams.get('oauth')
    if (oauthResult === 'success') {
      setOauthMsg({ ok: true, msg: 'OpenAI OAuth 연결이 완료되었습니다.' })
    } else if (oauthResult === 'error') {
      const msg = searchParams.get('msg') || 'unknown'
      setOauthMsg({ ok: false, msg: `OAuth 연결 실패: ${msg}` })
    }

    fetchAISettings()
      .then(data => {
        setSettings(data)
        setForm(f => ({
          ...f,
          enabled: data.enabled,
          provider: data.provider,
          openai_model: data.openai_model,
          ollama_base_url: data.ollama_base_url,
          ollama_model: data.ollama_model,
          feature_classify: data.feature_classify,
          feature_summarize: data.feature_summarize,
          feature_kb_suggest: data.feature_kb_suggest,
          openai_auth_method: data.openai_auth_method || 'api_key',
          openai_oauth_client_id: data.openai_oauth_client_id || '',
          openai_oauth_auth_url: data.openai_oauth_auth_url || '',
          openai_oauth_token_url: data.openai_oauth_token_url || '',
          openai_oauth_scope: data.openai_oauth_scope || 'openid',
        }))
      })
      .catch(() => setError('설정을 불러오는 중 오류가 발생했습니다.'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSave = async (overrides?: Partial<typeof form>) => {
    const merged = { ...form, ...overrides }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload: Parameters<typeof updateAISettings>[0] = {
        enabled: merged.enabled,
        provider: merged.provider,
        openai_model: merged.openai_model,
        ollama_base_url: merged.ollama_base_url,
        ollama_model: merged.ollama_model,
        feature_classify: merged.feature_classify,
        feature_summarize: merged.feature_summarize,
        feature_kb_suggest: merged.feature_kb_suggest,
        openai_auth_method: merged.openai_auth_method,
        openai_oauth_client_id: merged.openai_oauth_client_id || null,
        openai_oauth_auth_url: merged.openai_oauth_auth_url || null,
        openai_oauth_token_url: merged.openai_oauth_token_url || null,
        openai_oauth_scope: merged.openai_oauth_scope || null,
      }
      // API 키 입력값이 있을 때만 전송
      if (merged.openai_api_key.trim()) {
        payload.openai_api_key = merged.openai_api_key.trim()
      }
      // OAuth client_secret 입력값이 있을 때만 전송
      if (merged.openai_oauth_client_secret.trim()) {
        payload.openai_oauth_client_secret = merged.openai_oauth_client_secret.trim()
      }
      const updated = await updateAISettings(payload)
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => doSave()

  const [testElapsed, setTestElapsed] = useState(0)
  const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestElapsed(0)
    testTimerRef.current = setInterval(() => setTestElapsed(s => s + 1), 1000)
    try {
      const params: Parameters<typeof testAIConnection>[0] = {
        provider: form.provider,
        openai_model: form.openai_model,
        ollama_base_url: form.ollama_base_url,
        ollama_model: form.ollama_model,
      }
      if (form.openai_api_key.trim()) {
        params.openai_api_key = form.openai_api_key.trim()
      }
      type TestRes = { ok: boolean; provider: string; model?: string; connect_ms?: number; infer_ms?: number; sample_result: { category: string; priority: string; confidence: number; reasoning: string } }
      const res = await testAIConnection(params) as TestRes
      const model = res.model ?? (form.provider === 'ollama' ? form.ollama_model : form.openai_model)
      const inferSec = res.infer_ms != null ? `${(res.infer_ms / 1000).toFixed(1)}s` : ''
      setTestResult({
        ok: true,
        msg: `연결 성공! 모델: ${model} · 추론: ${inferSec} · 분류: ${res.sample_result.category}/${res.sample_result.priority}`,
      })
    } catch (e: unknown) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : '연결 실패' })
    } finally {
      setTesting(false)
      if (testTimerRef.current) { clearInterval(testTimerRef.current); testTimerRef.current = null }
    }
  }

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }))

  const handleFetchOllamaModels = async () => {
    if (!form.ollama_base_url.trim()) return
    setOllamaFetching(true)
    setOllamaFetchError(null)
    setOllamaFetched(false)
    try {
      const res = await fetchOllamaModels(form.ollama_base_url.trim())
      setOllamaModels(res.models)
      setOllamaFetched(true)
      if (res.models.length > 0 && !res.models.find(m => m.name === form.ollama_model)) {
        set('ollama_model', res.models[0].name)
      }
    } catch (e: unknown) {
      setOllamaFetchError(e instanceof Error ? e.message : 'Ollama 서버에 연결할 수 없습니다.')
      setOllamaModels([])
    } finally {
      setOllamaFetching(false)
    }
  }

  // Authorization Code Flow: 팝업 창에서 OAuth 로그인 후 postMessage로 결과 수신
  const handleOAuthConnect = async () => {
    setOauthWorking(true)
    setOauthMsg(null)
    try {
      await doSave()  // OAuth 설정 먼저 저장
    } catch {
      setOauthMsg({ ok: false, msg: '설정 저장 실패' })
      setOauthWorking(false)
      return
    }

    const redirectUri = `${window.location.origin}/api/admin/ai-settings/openai-oauth/callback`
    const startUrl = `/api/admin/ai-settings/openai-oauth/start?redirect_uri=${encodeURIComponent(redirectUri)}`

    const popup = window.open(startUrl, 'oauth_popup', 'width=520,height=680,scrollbars=yes,resizable=yes')
    if (!popup) {
      setOauthMsg({ ok: false, msg: '팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.' })
      setOauthWorking(false)
      return
    }

    const handleMessage = async (event: MessageEvent) => {
      // 같은 origin에서 온 메시지만 처리
      if (event.origin !== window.location.origin) return
      if (event.data?.event === 'oauth_success') {
        cleanup()
        setOauthMsg({ ok: true, msg: 'OpenAI OAuth 연결이 완료되었습니다.' })
        const updated = await fetchAISettings()
        setSettings(updated)
        setOauthWorking(false)
      } else if (event.data?.event === 'oauth_error') {
        cleanup()
        setOauthMsg({ ok: false, msg: `OAuth 연결 실패: ${event.data.msg}` })
        setOauthWorking(false)
      }
    }

    let closedTimer: ReturnType<typeof setInterval>
    const cleanup = () => {
      window.removeEventListener('message', handleMessage)
      clearInterval(closedTimer)
    }

    window.addEventListener('message', handleMessage)

    // 팝업을 중간에 닫으면 working 상태 해제
    closedTimer = setInterval(() => {
      if (popup.closed) {
        cleanup()
        setOauthWorking(false)
      }
    }, 800)
  }

  // Client Credentials Flow: 서버-to-서버 자동 토큰 발급
  const handleOAuthClientCredentials = async () => {
    setOauthWorking(true)
    setOauthMsg(null)
    try {
      await doSave()
      const res = await fetchOpenAIOAuthClientCredentials()
      setOauthMsg({ ok: true, msg: `토큰 발급 완료 (만료: ${res.expires_in ? `${res.expires_in}초 후` : '없음'})` })
      const updated = await fetchAISettings()
      setSettings(updated)
    } catch (e: unknown) {
      setOauthMsg({ ok: false, msg: e instanceof Error ? e.message : '토큰 발급 실패' })
    } finally {
      setOauthWorking(false)
    }
  }

  const handleOAuthDisconnect = async () => {
    setOauthWorking(true)
    setOauthMsg(null)
    try {
      await disconnectOpenAIOAuth()
      setOauthMsg({ ok: true, msg: 'OAuth 연결이 해제되었습니다.' })
      const updated = await fetchAISettings()
      setSettings(updated)
      setForm(f => ({ ...f, openai_auth_method: 'api_key' }))
    } catch (e: unknown) {
      setOauthMsg({ ok: false, msg: e instanceof Error ? e.message : '연결 해제 실패' })
    } finally {
      setOauthWorking(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-500">로딩 중...</div>

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="text-2xl">🤖</span> AI 설정
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            OpenAI 또는 Ollama를 사용해 티켓 자동 분류·요약·KB 추천 기능을 제공합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
        >
          {saving ? '저장 중...' : saved ? '✅ 저장됨' : '저장'}
        </button>
      </div>

      {/* 메인 토글 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">AI 기능 활성화</p>
            <p className="text-sm text-gray-500 mt-0.5">
              비활성화 시 모든 AI 기능이 일시 중지됩니다.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              const next = !form.enabled
              setForm(f => ({ ...f, enabled: next }))
              doSave({ enabled: next })
            }}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${
              form.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                form.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Provider 선택 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <p className="font-semibold text-gray-900 dark:text-white">AI 제공자</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'openai', label: 'OpenAI', icon: '🟢', desc: 'GPT-4o 계열 — 클라우드' },
            { value: 'ollama', label: 'Ollama', icon: '🦙', desc: '로컬 LLM — 인터넷 불필요' },
          ].map(p => (
            <button
              key={p.value}
              onClick={() => set('provider', p.value)}
              className={`flex flex-col items-start gap-1 p-4 rounded-lg border-2 transition-all text-left ${
                form.provider === p.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="text-2xl">{p.icon}</span>
              <span className="font-semibold text-gray-900 dark:text-white">{p.label}</span>
              <span className="text-xs text-gray-500">{p.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* OpenAI 설정 */}
      {form.provider === 'openai' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <p className="font-semibold text-gray-900 dark:text-white">OpenAI 설정</p>

          {/* 인증 방식 선택 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">인증 방식</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'api_key', label: 'API Key', icon: '🔑', desc: '정적 API 키 직접 입력' },
                { value: 'oauth', label: 'OAuth 2.0', icon: '🔐', desc: '클라이언트 ID/Secret 방식' },
              ].map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set('openai_auth_method', m.value)}
                  className={`flex flex-col items-start gap-0.5 p-3 rounded-lg border-2 transition-all text-left ${
                    form.openai_auth_method === m.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className="text-lg">{m.icon} <span className="text-sm font-semibold text-gray-900 dark:text-white">{m.label}</span></span>
                  <span className="text-xs text-gray-500">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API Key 방식 */}
          {form.openai_auth_method === 'api_key' && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                API 키
                {settings?.openai_api_key_set && !settings?.openai_oauth_connected && (
                  <span className="ml-2 text-xs text-green-600 dark:text-green-400">✓ 저장됨</span>
                )}
              </label>
              <input
                type="password"
                placeholder={settings?.openai_api_key_set ? '변경하려면 새 키 입력 (비워두면 유지)' : 'sk-...'}
                value={form.openai_api_key}
                onChange={e => set('openai_api_key', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400">
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                  className="text-blue-500 hover:underline">platform.openai.com</a>에서 발급
              </p>
            </div>
          )}

          {/* OAuth 2.0 방식 */}
          {form.openai_auth_method === 'oauth' && (
            <div className="space-y-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 p-4">
              {/* 연결 상태 */}
              {settings?.openai_oauth_connected ? (
                <div className="flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 px-3 py-2">
                  <span className="text-sm text-green-700 dark:text-green-300">✅ OAuth 연결됨 (토큰 보유)</span>
                  <button
                    type="button"
                    onClick={handleOAuthDisconnect}
                    disabled={oauthWorking}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    연결 해제
                  </button>
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  ⚠️ OAuth 미연결 — 아래 설정 후 연결하세요.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Client ID</label>
                  <input
                    type="text"
                    placeholder="client_id"
                    value={form.openai_oauth_client_id}
                    onChange={e => set('openai_oauth_client_id', e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    Client Secret
                    {settings?.openai_oauth_connected && <span className="ml-1 text-green-600">✓</span>}
                  </label>
                  <input
                    type="password"
                    placeholder={settings?.openai_oauth_connected ? '변경하려면 입력' : 'client_secret'}
                    value={form.openai_oauth_client_secret}
                    onChange={e => set('openai_oauth_client_secret', e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Token URL (토큰 교환)</label>
                <input
                  type="text"
                  placeholder="https://auth.openai.com/oauth/token"
                  value={form.openai_oauth_token_url}
                  onChange={e => set('openai_oauth_token_url', e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Auth URL <span className="font-normal text-gray-400">(Authorization Code Flow 시)</span>
                </label>
                <input
                  type="text"
                  placeholder="https://auth.openai.com/oauth/authorize"
                  value={form.openai_oauth_auth_url}
                  onChange={e => set('openai_oauth_auth_url', e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Scope</label>
                <input
                  type="text"
                  placeholder="openid"
                  value={form.openai_oauth_scope}
                  onChange={e => set('openai_oauth_scope', e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* 연결 버튼 */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleOAuthClientCredentials}
                  disabled={oauthWorking || !form.openai_oauth_client_id || !form.openai_oauth_token_url}
                  className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                  title="Client Credentials — 서버-to-서버 자동 토큰 발급"
                >
                  {oauthWorking ? '처리 중...' : '🔐 Client Credentials 연결'}
                </button>
                <button
                  type="button"
                  onClick={handleOAuthConnect}
                  disabled={oauthWorking || !form.openai_oauth_client_id || !form.openai_oauth_auth_url}
                  className="flex-1 py-2 rounded-lg border border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 text-blue-600 dark:text-blue-400 text-xs font-semibold transition-colors"
                  title="Authorization Code Flow — 팝업 창에서 로그인 후 자동 완료"
                >
                  {oauthWorking ? '처리 중...' : '🌐 브라우저 로그인으로 연결'}
                </button>
              </div>

              {oauthMsg && (
                <div className={`rounded px-3 py-2 text-xs ${
                  oauthMsg.ok
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                }`}>
                  {oauthMsg.ok ? '✅ ' : '❌ '}{oauthMsg.msg}
                </div>
              )}

              <p className="text-xs text-gray-400 border-t border-gray-200 dark:border-gray-600 pt-2">
                <strong>Client Credentials</strong>: 서버-to-서버 자동 인증 (Azure OpenAI, 엔터프라이즈용)<br/>
                <strong>브라우저 로그인</strong>: 팝업 창에서 계정 로그인 → 완료 시 자동 닫힘
              </p>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">모델</label>
            <select
              value={form.openai_model}
              onChange={e => set('openai_model', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {OPENAI_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Ollama 설정 */}
      {form.provider === 'ollama' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <p className="font-semibold text-gray-900 dark:text-white">Ollama 설정</p>

          {/* URL 입력 + 모델 목록 조회 버튼 */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ollama 서버 URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="http://host.docker.internal:11434"
                value={form.ollama_base_url}
                onChange={e => {
                  set('ollama_base_url', e.target.value)
                  setOllamaFetched(false)
                  setOllamaModels([])
                  setOllamaFetchError(null)
                }}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleFetchOllamaModels}
                disabled={ollamaFetching || !form.ollama_base_url.trim()}
                className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors whitespace-nowrap"
              >
                {ollamaFetching ? '조회 중...' : '모델 목록'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Docker 내부: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">http://ollama:11434</code>
              {' '}· 호스트 머신: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">http://host.docker.internal:11434</code>
            </p>
          </div>

          {/* 조회 오류 */}
          {ollamaFetchError && (
            <div className="rounded-lg px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-xs text-red-600 dark:text-red-400">
              ❌ {ollamaFetchError}
            </div>
          )}

          {/* 모델 선택 — 목록 조회 성공 시 */}
          {ollamaFetched && ollamaModels.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                모델 선택
                <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">
                  ✓ {ollamaModels.length}개 모델 발견
                </span>
              </label>
              <div className="space-y-1.5 max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 p-1">
                {ollamaModels.map(m => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => set('ollama_model', m.name)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-left text-sm transition-colors ${
                      form.ollama_model === m.name
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    <span className="font-mono font-medium">{m.name}</span>
                    <span className={`text-xs ml-2 shrink-0 ${form.ollama_model === m.name ? 'text-blue-100' : 'text-gray-400'}`}>
                      {m.parameter_size && `${m.parameter_size} · `}{m.size_gb}GB
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 목록 조회 성공했지만 모델 없음 */}
          {ollamaFetched && ollamaModels.length === 0 && (
            <div className="rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-700 dark:text-amber-300">
              ⚠️ 서버에 설치된 모델이 없습니다.{' '}
              <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">ollama pull llama3.2</code> 명령으로 모델을 먼저 설치하세요.
            </div>
          )}

          {/* 목록 조회 전 — 직접 입력 폴백 */}
          {!ollamaFetched && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                모델 이름
                <span className="ml-2 text-xs font-normal text-gray-400">목록 조회 후 선택하거나 직접 입력</span>
              </label>
              <input
                type="text"
                placeholder="llama3.2"
                value={form.ollama_model}
                onChange={e => set('ollama_model', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400">
                예: llama3.2, mistral, qwen2.5 —{' '}
                <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ollama pull llama3.2</code>로 다운로드
              </p>
            </div>
          )}
        </div>
      )}

      {/* 기능별 ON/OFF */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
        <p className="font-semibold text-gray-900 dark:text-white">기능 설정</p>
        {[
          {
            key: 'feature_classify',
            icon: '🏷️',
            label: '자동 분류',
            desc: '티켓 작성 시 카테고리·우선순위 AI 제안',
          },
          {
            key: 'feature_summarize',
            icon: '📝',
            label: '스레드 요약',
            desc: '티켓 상세에서 댓글 스레드 AI 요약',
          },
          {
            key: 'feature_kb_suggest',
            icon: '📚',
            label: 'KB 문서 추천',
            desc: '티켓 내용과 관련된 지식베이스 자동 추천',
          },
        ].map(feat => (
          <div key={feat.key} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
            <div className="flex items-start gap-3">
              <span className="text-xl mt-0.5">{feat.icon}</span>
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{feat.label}</p>
                <p className="text-xs text-gray-500">{feat.desc}</p>
              </div>
            </div>
            <button
              onClick={() => set(feat.key, !form[feat.key as keyof typeof form])}
              className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus:outline-none ${
                form[feat.key as keyof typeof form] ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form[feat.key as keyof typeof form] ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {/* 연결 테스트 결과 */}
      {testResult && (
        <div className={`rounded-lg p-4 text-sm ${
          testResult.ok
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700'
        }`}>
          {testResult.ok ? '✅ ' : '❌ '}{testResult.msg}
        </div>
      )}

      {error && (
        <div className="rounded-lg p-4 text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700">
          ❌ {error}
        </div>
      )}

      {/* 버튼 영역 */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
        >
          {saving ? '저장 중...' : saved ? '✅ 저장됨' : '저장'}
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          title="저장 전에도 현재 폼 설정으로 테스트 가능"
          className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 text-sm font-medium transition-colors"
        >
          {testing ? `테스트 중... ${testElapsed}s` : '연결 테스트'}
        </button>
      </div>

      {/* 안내 */}
      <div className="text-xs text-gray-400 space-y-1 border-t border-gray-100 dark:border-gray-700 pt-4">
        <p>• OpenAI API 키는 암호화되어 DB에 저장되며 화면에 노출되지 않습니다.</p>
        <p>• Ollama 사용 시 <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">docker compose up ollama</code>로 서비스를 먼저 시작하세요.</p>
        <p>• 연결 테스트는 저장된 설정(Enable 상태)으로 실행됩니다.</p>
      </div>
    </div>
  )
}
