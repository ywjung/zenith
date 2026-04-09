/**
 * 인라인 로딩 스피너 아이콘.
 * 버튼/입력 필드 옆에 disabled 상태와 함께 사용.
 */
export default function SpinnerIcon({
  className = 'w-4 h-4',
  ariaLabel = '로딩 중',
}: { className?: string; ariaLabel?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label={ariaLabel}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
