'use client'

import { useState } from 'react'

const RESOLUTION_TYPES = [
  { value: 'permanent_fix', label: '🔧 영구 해결', desc: '근본 원인이 제거됨' },
  { value: 'workaround',    label: '🔄 임시 해결', desc: '재발 가능, 모니터링 필요' },
  { value: 'no_action',     label: '⏭️ 조치 불필요', desc: '오인 신고 또는 자동 복구' },
  { value: 'duplicate',     label: '♻️ 중복 티켓', desc: '다른 티켓과 동일한 문제' },
  { value: 'by_mr',         label: '🔀 MR 머지로 해결', desc: 'GitLab MR 배포로 해결' },
]

interface Props {
  ticketIid: number
  targetStatus: 'resolved' | 'closed'
  onConfirm: (note: string, type: string, reason: string) => void
  onCancel: () => void
}

export default function ResolutionNoteModal({ ticketIid, targetStatus, onConfirm, onCancel }: Props) {
  const [note, setNote] = useState('')
  const [type, setType] = useState('permanent_fix')
  const [reason, setReason] = useState('')

  const statusLabel = targetStatus === 'resolved' ? '처리완료' : '종료'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* 헤더 */}
        <div className="px-6 pt-6 pb-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            ✅ 티켓 #{ticketIid} — {statusLabel} 처리
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            해결 방법을 기록하면 유사 문제 재발 시 빠르게 대응할 수 있습니다.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 해결 유형 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">해결 유형</label>
            <div className="grid grid-cols-1 gap-2">
              {RESOLUTION_TYPES.map(t => (
                <label
                  key={t.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    type === t.value
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="resolution_type"
                    value={t.value}
                    checked={type === t.value}
                    onChange={() => setType(t.value)}
                    className="shrink-0"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-800">{t.label}</div>
                    <div className="text-xs text-gray-500">{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 해결 노트 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              해결 방법 요약
              <span className="text-gray-400 font-normal ml-1">(선택)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              placeholder="어떻게 해결했는지 간략히 기술하세요. 추후 KB 아티클로 변환할 수 있습니다."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              maxLength={5000}
            />
            <div className="text-xs text-gray-400 text-right mt-0.5">{note.length}/5000</div>
          </div>

          {/* 상태 변경 이유 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              변경 이유
              <span className="text-gray-400 font-normal ml-1">(선택)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="예: 현장 방문 후 장치 교체 완료"
              maxLength={500}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t flex items-center justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(note, type, reason)}
            className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            {statusLabel}로 변경
          </button>
        </div>
      </div>
    </div>
  )
}
