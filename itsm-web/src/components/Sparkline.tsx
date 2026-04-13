'use client'

/**
 * 작은 SVG sparkline. 데이터 의존성 없음.
 *
 * 사용 예: <Sparkline data={[1,3,2,5,4,6]} color="#3b82f6" />
 */
export default function Sparkline({
  data,
  color = '#3b82f6',
  width = 80,
  height = 24,
  className = '',
}: {
  data: number[]
  color?: string
  width?: number
  height?: number
  className?: string
}) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const stepX = data.length > 1 ? width / (data.length - 1) : 0

  const points = data
    .map((v, i) => {
      const x = i * stepX
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // 면적 fill용 path
  const areaPath = `M0,${height} L${points.split(' ').join(' L')} L${width},${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    >
      <path d={areaPath} fill={color} fillOpacity="0.15" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* 마지막 점 강조 */}
      {data.length > 0 && (
        <circle
          cx={(data.length - 1) * stepX}
          cy={height - ((data[data.length - 1] - min) / range) * height}
          r="2"
          fill={color}
        />
      )}
    </svg>
  )
}
