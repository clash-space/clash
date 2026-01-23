'use client';

export default function Background() {
  return (
    <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-white">
      {/* Infinite Canvas Dot Grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.5
        }}
      />

      {/* Artistic Node Connections - Subtle Flow Lines */}
      <div className="absolute inset-0 opacity-20">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid-connections" x="0" y="0" width="400" height="400" patternUnits="userSpaceOnUse">
              {/* Vertical Dashed Line - Suggesting structure/connection */}
              <path d="M 200 0 L 200 400" stroke="#FF6B50" strokeWidth="1" fill="none" strokeDasharray="4 4" />
              {/* Horizontal Dashed Line - Suggesting structure/connection */}
              <path d="M 0 200 L 400 200" stroke="#FF6B50" strokeWidth="1" fill="none" strokeDasharray="4 4" />

              {/* Connection Points */}
              <circle cx="200" cy="200" r="2" fill="#FF6B50" />
              <circle cx="200" cy="100" r="1.5" fill="#FF6B50" opacity="0.6" />
              <circle cx="100" cy="200" r="1.5" fill="#FF6B50" opacity="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid-connections)" />
        </svg>
      </div>

      {/* Gradient Mask for Depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/50 to-white" />
    </div>
  );
}
