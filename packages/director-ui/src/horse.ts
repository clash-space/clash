export type DirectorHorseGait = "auto" | "idle" | "walk" | "trot" | "gallop";

export interface DirectorHorseGaitPose {
  gait: Exclude<DirectorHorseGait, "auto">;
  bodyBob: number;
  bodyPitch: number;
  neckPitch: number;
  frontLeft: number;
  frontRight: number;
  rearLeft: number;
  rearRight: number;
}

function resolvedGait(gait: DirectorHorseGait, speed: number): DirectorHorseGaitPose["gait"] {
  if (gait !== "auto") return gait;
  if (speed < 0.04) return "idle";
  if (speed < 1.8) return "walk";
  if (speed < 4.2) return "trot";
  return "gallop";
}

export function directorHorseGaitPose({
  gait,
  speed,
  timeSeconds,
}: {
  gait: DirectorHorseGait;
  speed: number;
  timeSeconds: number;
}): DirectorHorseGaitPose {
  const activeGait = resolvedGait(gait, Math.max(0, speed));
  if (activeGait === "idle") {
    const breath = Math.sin(timeSeconds * 1.8);
    return {
      gait: activeGait,
      bodyBob: breath * 0.008,
      bodyPitch: 0,
      neckPitch: breath * 0.012,
      frontLeft: 0,
      frontRight: 0,
      rearLeft: 0,
      rearRight: 0,
    };
  }
  const gaitRate = activeGait === "walk" ? 1.3 : activeGait === "trot" ? 2.1 : 3.1;
  const stride = activeGait === "walk" ? 0.34 : activeGait === "trot" ? 0.52 : 0.72;
  const phase = timeSeconds * Math.PI * 2 * gaitRate;
  const left = Math.sin(phase) * stride;
  const right = Math.sin(phase + Math.PI) * stride;
  const gallopOffset = activeGait === "gallop" ? 0.55 : Math.PI;
  return {
    gait: activeGait,
    bodyBob: Math.abs(Math.sin(phase * 2)) * (activeGait === "gallop" ? 0.09 : 0.035),
    bodyPitch: Math.sin(phase * 2) * (activeGait === "gallop" ? 0.045 : 0.018),
    neckPitch: -Math.sin(phase * 2) * (activeGait === "gallop" ? 0.08 : 0.025),
    frontLeft: left,
    frontRight: right,
    rearLeft: Math.sin(phase + gallopOffset) * stride,
    rearRight: Math.sin(phase + gallopOffset + Math.PI) * stride,
  };
}
