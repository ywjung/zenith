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
        {/* zenith point - 황금 다이아몬드 */}
        <div
          style={{
            width: 10,
            height: 10,
            background: '#FCD34D',
            transform: 'rotate(45deg)',
            borderRadius: 2,
          }}
        />
        {/* Z 레터 */}
        <div
          style={{
            color: 'white',
            fontSize: 14,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            lineHeight: 1,
          }}
        >
          Z
        </div>
      </div>
    ),
    size,
  )
}
