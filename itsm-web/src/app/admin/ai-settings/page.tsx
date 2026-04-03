'use client'

import { useEffect, useState } from 'react'
import {
  fetchAISettings, updateAISettings, testAIConnection,
  type AISettingsData,
} from '@/lib/api'

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (빠름·저렴)' },
  { value: 'gpt-4o', label: 'GPT-4o (고품질)' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
]

export default function AISettingsPage() {
  const [settings, setSettings] = useState<AISettingsData | null>(null)
  const [form, setForm] = useState({
    enabled: false,
    provider: 'openai',
    openai_api_key: '',        // '' = 변경 없음
    openai_model: 'gpt-4o-mini',
    ollama_base_url: 'http://ollama:11434',
    ollama_model: 'llama3.2',
    feature_classify: true,
    feature_summarize: true,
    feature_kb_suggest: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        }))
      })
      .catch(() => setError('설정을 불러오는 중 오류가 발생했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload: Parameters<typeof updateAISettings>[0] = {
        enabled: form.enabled,
        provider: form.provider,
        openai_model: form.openai_model,
        ollama_base_url: form.ollama_base_url,
        ollama_model: form.ollama_model,
        feature_classify: form.feature_classify,
        feature_summarize: form.feature_summarize,
        feature_kb_suggest: form.feature_kb_suggest,
      }
      // API 키 입력값이 있을 때만 전송
      if (form.openai_api_key.trim()) {
        payload.openai_api_key = form.openai_api_key.trim()
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

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testAIConnection()
      setTestResult({
        ok: true,
        msg: `연결 성공! (${res.provider}) 샘플 분류: ${res.sample_result.category} / ${res.sample_result.priority} (확신도: ${Math.round((res.sample_result.confidence ?? 0) * 100)}%)`,
      })
    } catch (e: unknown) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : '연결 실패' })
    } finally {
      setTesting(false)
    }
  }

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }))

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
            onClick={() => set('enabled', !form.enabled)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
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

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              API 키
              {settings?.openai_api_key_set && (
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

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ollama 서버 URL</label>
            <input
              type="text"
              placeholder="http://ollama:11434"
              value={form.ollama_base_url}
              onChange={e => set('ollama_base_url', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">
              Docker로 실행 중이면 <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">http://ollama:11434</code>
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">모델 이름</label>
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
          disabled={testing || !form.enabled}
          className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 text-sm font-medium transition-colors"
        >
          {testing ? '테스트 중...' : '연결 테스트'}
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
