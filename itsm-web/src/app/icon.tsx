import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: '#1D4ED8',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        {/* 황금 별 */}
        <div style={{ fontSize: 13, lineHeight: 1 }}>⭐</div>
        {/* Z 레터 */}
        <div
          style={{
            color: 'white',
            fontSize: 13,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            lineHeight: 1,
            marginTop: -1,
          }}
        >
          Z
        </div>
      </div>
    ),
    size,
  )
}
