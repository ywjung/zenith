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
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          src={`data:image/svg+xml;utf8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <polygon points="16,4 17.2,8.4 21.6,8.4 18.2,11 19.4,15.4 16,12.8 12.6,15.4 13.8,11 10.4,8.4 14.8,8.4" fill="#FCD34D"/>
  <path d="M9 18.5H22L9 26H23" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
          )}`}
          alt=""
          style={{ width: 32, height: 32 }}
        />
      </div>
    ),
    size,
  )
}
