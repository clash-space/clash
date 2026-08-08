import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export default function LowerThird() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 150 } });
  const exit = interpolate(
    frame,
    [durationInFrames - 18, durationInFrames - 1],
    [1, 0],
    clamp,
  );
  const titleY = interpolate(enter, [0, 1], [52, 0], clamp);
  const barX = interpolate(enter, [0, 1], [-780, 0], clamp);

  return (
    <AbsoluteFill
      style={{ backgroundColor: "transparent", justifyContent: "flex-end" }}
    >
      <div
        style={{
          margin: "0 72px 220px",
          opacity: exit,
          transform: `translateX(${barX}px)`,
        }}
      >
        <div
          style={{
            width: 720,
            borderRadius: 30,
            background: "#101820",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.28)",
            boxSizing: "border-box",
            padding: "28px 44px 34px",
          }}
        >
          <div
            style={{
              color: "#7dd3fc",
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: 2.4,
              transform: `translateY(${titleY * 0.55}px)`,
            }}
          >
            LOCAL-FIRST CLASH
          </div>
          <div
            style={{
              color: "#f8fafc",
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 58,
              fontWeight: 850,
              lineHeight: 1.04,
              marginTop: 8,
              transform: `translateY(${titleY}px)`,
            }}
          >
            Agent owns cwd
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
