import { ImageResponse } from 'next/og';

// Image metadata
export const size = {
  width: 32,
  height: 32,
};
export const contentType = 'image/png';

// Load Space Grotesk font
async function loadGoogleFont(font: string, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/);

  if (resource) {
    const response = await fetch(resource[1]);
    if (response.status == 200) {
      return await response.arrayBuffer();
    }
  }

  throw new Error('Failed to load font data');
}

export default async function Icon() {
  const fontData = await loadGoogleFont('Space+Grotesk:wght@700', 'C');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '32px',
            transform: 'scale(0.8)', // Scale down to 80% to prevent cutoff
          }}
        >
          {/* C - Matches text-4xl font-bold tracking-tighter leading-none */}
          <div
            style={{
              fontSize: 32, // text-4xl is usually 36px, but for 32px icon we scale slightly
              fontFamily: '"Space Grotesk"',
              fontWeight: 700,
              letterSpacing: '-0.05em', // tracking-tighter
              lineHeight: 1,
              color: '#171717', // text-gray-900
              display: 'flex',
              alignItems: 'center',
              marginTop: '-2px', // Fine-tune vertical center
            }}
          >
            C
          </div>
          {/* Slash - Matches h-8 w-[6px] -skew-x-[20deg] */}
          <div
            style={{
              width: '5px', // slightly scaled for 32px canvas
              height: '24px',
              backgroundColor: '#FF6B50', // bg-brand
              transform: 'skewX(-20deg)',
              marginLeft: '2px', // gap-1
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'Space Grotesk',
          data: fontData,
          style: 'normal',
          weight: 700,
        },
      ],
    }
  );
}
