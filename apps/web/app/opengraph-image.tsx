import { ImageResponse } from 'next/og';

// Image metadata for Open Graph
export const alt = 'Clash - Video Agent';
export const size = {
  width: 1200,
  height: 630,
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

export default async function Image() {
  // Load fonts - Space Grotesk for headings, Inter for body
  const spaceGroteskData = await loadGoogleFont('Space+Grotesk:wght@700', 'Clash');
  const interData = await loadGoogleFont('Inter:wght@500', 'AI-powered video creation');

  return new ImageResponse(
    (
      <div
        style={{
          background: 'white',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Logo Container - Scaled up version of the navbar logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '40px',
            transform: 'scale(4)', // Scale up the base vector layout
            transformOrigin: 'center',
          }}
        >
          {/* "C" character */}
          <div
            style={{
              fontSize: 32,
              fontFamily: '"Space Grotesk"',
              fontWeight: 700,
              letterSpacing: '-0.05em',
              lineHeight: 1,
              color: '#171717',
              marginTop: '-2px',
            }}
          >
            C
          </div>
          {/* "/" slash */}
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

        {/* Title Text */}
        <div
          style={{
            fontSize: 72,
            fontFamily: '"Space Grotesk"',
            fontWeight: 700,
            color: '#171717',
            marginBottom: '20px',
            letterSpacing: '-0.02em',
          }}
        >
          Clash
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 32,
            fontFamily: '"Inter"',
            color: '#6b7280',
            fontWeight: 500,
          }}
        >
          AI-powered video creation and editing platform
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'Space Grotesk',
          data: spaceGroteskData,
          style: 'normal',
          weight: 700,
        },
        {
          name: 'Inter',
          data: interData,
          style: 'normal',
          weight: 500,
        },
      ],
    }
  );
}
