'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  fetchAISettings, updateAISettings, testAIConnection, fetchOllamaModels,
  type AISettingsData, type OllamaModel,
} from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import SpinnerIcon from '@/components/SpinnerIcon'

const OPENAI_MODEL_VALUES = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] as const
const OPENAI_MODEL_KEY: Record<string, string> = {
  'gpt-4o-mini': 'model_gpt4o_mini_label',
  'gpt-4o':      'model_gpt4o_label',
  'gpt-4-turbo': 'model_gpt4_turbo_label',
}

export default function AISettingsPage() {
  const t = useTranslations('admin.ai_settings')
  const [settings, setSettings] = useState<AISettingsData | null>(null)

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
    openai_auth_method: 'api_key',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Ollama 모델 목록 조회
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [ollamaFetching, setOllamaFetching] = useState(false)
  const [ollamaFetchError, setOllamaFetchError] = useState<string | null>(null)
  const [ollamaFetched, setOllamaFetched] = useState(false)

  useEffect(() => {
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
        }))
      })
      .catch(() => setError(t('load_failed')))
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
      }
      // API 키 입력값이 있을 때만 전송
      if (merged.openai_api_key.trim()) {
        payload.openai_api_key = merged.openai_api_key.trim()
      }
      const updated = await updateAISettings(payload)
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(errorMessage(e, t('save_failed')))
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
        msg: t('test_success', { model, sec: inferSec, cat: res.sample_result.category, prio: res.sample_result.priority }),
      })
    } catch (e: unknown) {
      setTestResult({ ok: false, msg: errorMessage(e, t('test_failed')) })
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
      setOllamaFetchError(errorMessage(e, t('ollama_unreachable')))
      setOllamaModels([])
    } finally {
      setOllamaFetching(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-500">{t('loading')}</div>

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="text-2xl">🤖</span> {t('title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center gap-2"
        >
          {saving && <SpinnerIcon className="w-4 h-4" />}
          {saving ? t('saving') : saved ? t('saved') : t('save')}
        </button>
      </div>

      {/* 메인 토글 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{t('enable_ai')}</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {t('enable_ai_hint')}
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
        <p className="font-semibold text-gray-900 dark:text-white">{t('provider_title')}</p>
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          {t('provider_hint')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'openai', label: t('openai_label'), icon: '🟢', desc: t('openai_desc') },
            { value: 'ollama', label: t('ollama_label'), icon: '🦙', desc: t('ollama_desc') },
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
          <p className="font-semibold text-gray-900 dark:text-white">{t('openai_title')}</p>

          {/* API 키 */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('api_key')}
              {settings?.openai_api_key_set && (
                <span className="ml-2 text-xs text-green-600 dark:text-green-400">{t('api_key_saved')}</span>
              )}
            </label>
            <input
              type="password"
              autoComplete="off"
              placeholder={settings?.openai_api_key_set ? t('api_key_change_placeholder') : 'sk-...'}
              value={form.openai_api_key}
              onChange={e => set('openai_api_key', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                className="text-blue-500 hover:underline">platform.openai.com</a>{t('api_key_hint_suffix')}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('model_label')}</label>
            <select
              value={form.openai_model}
              onChange={e => set('openai_model', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {OPENAI_MODEL_VALUES.map(v => (
                <option key={v} value={v}>{t(OPENAI_MODEL_KEY[v] as 'model_gpt4o_mini_label')}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Ollama 설정 */}
      {form.provider === 'ollama' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <p className="font-semibold text-gray-900 dark:text-white">{t('ollama_title')}</p>

          {/* URL 입력 + 모델 목록 조회 버튼 */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('ollama_url_label')}</label>
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
                {ollamaFetching ? t('fetching_models') : t('fetch_models')}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              {t('docker_hint_prefix')}<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">http://ollama:11434</code>
              {t('docker_hint_middle')}<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">http://host.docker.internal:11434</code>
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
              {t('no_models_found')} <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">ollama pull llama3.2</code>{t('no_models_cmd_suffix')}
            </div>
          )}

          {/* 목록 조회 전 — 직접 입력 폴백 */}
          {!ollamaFetched && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('model_name_label')}
                <span className="ml-2 text-xs font-normal text-gray-400">{t('model_name_hint')}</span>
              </label>
              <input
                type="text"
                placeholder="llama3.2"
                value={form.ollama_model}
                onChange={e => set('ollama_model', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400">
                {t('model_examples_prefix')}<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ollama pull llama3.2</code>{t('model_examples_suffix')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 기능별 ON/OFF */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
        <p className="font-semibold text-gray-900 dark:text-white">{t('features_title')}</p>
        {[
          {
            key: 'feature_classify',
            icon: '🏷️',
            label: t('feature_classify'),
            desc: t('feature_classify_desc'),
          },
          {
            key: 'feature_summarize',
            icon: '📝',
            label: t('feature_summarize'),
            desc: t('feature_summarize_desc'),
          },
          {
            key: 'feature_kb_suggest',
            icon: '📚',
            label: t('feature_kb'),
            desc: t('feature_kb_desc'),
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
          className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
        >
          {saving && <SpinnerIcon className="w-4 h-4" />}
          {saving ? t('saving') : saved ? t('saved') : t('save')}
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          title={t('test_tooltip')}
          className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 text-sm font-medium transition-colors"
        >
          {testing ? t('testing_progress', { sec: testElapsed }) : t('test_connection')}
        </button>
      </div>

      {/* 안내 */}
      <div className="text-xs text-gray-400 space-y-1 border-t border-gray-100 dark:border-gray-700 pt-4">
        <p>{t('info_1')}</p>
        <p>{t('info_2_prefix')}<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">docker compose up ollama</code>{t('info_2_suffix')}</p>
        <p>{t('info_3')}</p>
      </div>
    </div>
  )
}
