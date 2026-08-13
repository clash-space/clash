// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractiveCanvas } from "./InteractiveCanvas";

const playerApi = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  getCurrentFrame: vi.fn(() => 0),
  pause: vi.fn(),
  play: vi.fn(),
  seekTo: vi.fn(),
}));

vi.mock("@remotion/player", async () => {
  const ReactModule = await import("react");
  const { createPortal } = await import("react-dom");
  return {
    Player: ReactModule.forwardRef(
      (props: { numberOfSharedAudioTags?: number }, ref) => {
        ReactModule.useImperativeHandle(ref, () => playerApi);
        return createPortal(
          <audio
            data-testid="preview-audio"
            data-timeline-audio=""
            data-shared-audio-tags={props.numberOfSharedAudioTags}
          />,
          document.body,
        );
      },
    ),
  };
});

let nextAnimationFrame: FrameRequestCallback | null = null;
let analyserIndex = 0;
const stoppedTrack = { stop: vi.fn() };
const capturedStream = {
  getAudioTracks: () => [stoppedTrack],
  getTracks: () => [stoppedTrack],
} as unknown as MediaStream;

const audioNode = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
});

class AudioContextStub {
  state: AudioContextState = "running";
  destination = audioNode() as unknown as AudioDestinationNode;

  createGain() {
    return { ...audioNode(), gain: { value: 1 } } as unknown as GainNode;
  }

  createMediaStreamSource() {
    return audioNode() as unknown as MediaStreamAudioSourceNode;
  }

  createChannelSplitter() {
    return audioNode() as unknown as ChannelSplitterNode;
  }

  createAnalyser() {
    const channel = analyserIndex++ % 2;
    return {
      ...audioNode(),
      fftSize: 256,
      getFloatTimeDomainData: (samples: Float32Array) => {
        samples.fill(channel === 0 ? 0.5 : 0.25);
      },
    } as unknown as AnalyserNode;
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

beforeEach(() => {
  analyserIndex = 0;
  nextAnimationFrame = null;
  stoppedTrack.stop.mockClear();
  vi.stubGlobal("AudioContext", AudioContextStub);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      nextAnimationFrame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLMediaElement.prototype, "captureStream", {
    configurable: true,
    value: vi.fn(() => capturedStream),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (
    HTMLMediaElement.prototype as HTMLMediaElement & {
      captureStream?: () => MediaStream;
    }
  ).captureStream;
});

describe("InteractiveCanvas live audio meter", () => {
  it("bypasses the shared audio pool so timeline sound uses a real media element", () => {
    render(
      <InteractiveCanvas
        tracks={[]}
        selectedItemId={null}
        currentFrame={0}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={30}
        durationInFrames={90}
        onUpdateItem={vi.fn()}
      />,
    );

    expect(
      screen
        .getByTestId("preview-audio")
        .getAttribute("data-shared-audio-tags"),
    ).toBe("0");
  });

  it("reports current stereo RMS levels without using player volume controls", () => {
    const onAudioLevelsChange = vi.fn();
    render(
      <InteractiveCanvas
        tracks={[]}
        selectedItemId={null}
        currentFrame={0}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={30}
        durationInFrames={90}
        onUpdateItem={vi.fn()}
        audioMeterEnabled
        onAudioLevelsChange={onAudioLevelsChange}
      />,
    );

    expect(nextAnimationFrame).not.toBeNull();
    act(() => nextAnimationFrame?.(0));

    const liveSample = onAudioLevelsChange.mock.calls.find(
      ([levels]) => levels.left > 0 && levels.right > 0,
    )?.[0];
    expect(liveSample?.left).toBeCloseTo(0.5, 4);
    expect(liveSample?.right).toBeCloseTo(0.25, 4);
    expect("setVolume" in playerApi).toBe(false);
    expect("mute" in playerApi).toBe(false);
  });
});
