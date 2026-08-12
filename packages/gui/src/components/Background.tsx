
export default function Background() {
  return (
    <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-warm-page">
      {/* Infinite Canvas Dot Grid. Uses the --canvas-dot token so the
          dot tint flips with light/dark mode (light: warm gray, dark: slate). */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(var(--canvas-dot) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.38,
        }}
      />

      {/* Artistic node connections. `color: var(--brand)` + currentColor
          on the strokes/fills means the SVG inherits brand color from
          CSS variables — no hard-coded hex needed. */}
      <div className="absolute inset-0 opacity-[0.025] text-brand">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <pattern id="grid-connections" x="0" y="0" width="400" height="400" patternUnits="userSpaceOnUse">
              <path d="M 200 0 L 200 400" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="4 4" />
              <path d="M 0 200 L 400 200" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="4 4" />
              <circle cx="200" cy="200" r="2" fill="currentColor" />
              <circle cx="200" cy="100" r="1.5" fill="currentColor" opacity="0.6" />
              <circle cx="100" cy="200" r="1.5" fill="currentColor" opacity="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid-connections)" />
        </svg>
      </div>

      {/* Subtle depth mask. Keep it barely present so the canvas language stays visible. */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-warm-page/[0.0008]" />
    </div>
  );
}
