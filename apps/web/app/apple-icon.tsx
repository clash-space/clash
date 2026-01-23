import { ImageResponse } from 'next/og';

// Image metadata for Apple touch icon
export const size = {
  width: 180,
  height: 180,
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

export default async function AppleIcon() {
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
          background: 'white',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'scale(3.6)', // Scaled down from 4.5 (80%) to prevent corner cutoff
            transformOrigin: 'center',
          }}
        >
          {/* C */}
          <div
            style={{
              fontSize: 32,
              fontFamily: '"Space Grotesk"',
              fontWeight: 700,
              letterSpacing: '-0.05em',
              lineHeight: 1,
              color: '#171717',
              display: 'flex',
              alignItems: 'center',
              marginTop: '-2px',
            }}
          >
            C
          </div>
          {/* Slash */}
          <div
            style={{
              width: '5px',
              height: '24px',
              backgroundColor: '#FF6B50',
              transform: 'skewX(-20deg)',
              marginLeft: '2px',
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
