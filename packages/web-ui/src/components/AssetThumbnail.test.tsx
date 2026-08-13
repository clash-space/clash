// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetThumbnail } from "../features/assets/AssetThumbnail";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
});

function installBrowserPosterCapture() {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["poster"], { type: "image/jpeg" })),
  );

  const NativeUrl = globalThis.URL;
  class TestUrl extends NativeUrl {}
  const createObjectURL = vi.fn(() => "blob:https://clash.test/poster-1");
  const revokeObjectURL = vi.fn();
  Object.defineProperties(TestUrl, {
    createObjectURL: { value: createObjectURL },
    revokeObjectURL: { value: revokeObjectURL },
  });
  vi.stubGlobal("URL", TestUrl);

  return { createObjectURL, drawImage, revokeObjectURL };
}

function readyVideoForPoster(video: HTMLVideoElement) {
  Object.defineProperties(video, {
    duration: { configurable: true, value: 12 },
    videoHeight: { configurable: true, value: 1080 },
    videoWidth: { configurable: true, value: 1920 },
  });
}

describe("AssetThumbnail", () => {
  it("renders image media and never decodes a video playback URL as a thumbnail", () => {
    const { rerender } = render(
      <AssetThumbnail kind="image" src="/image.png" label="image.png" />,
    );

    expect(
      screen
        .getByRole("img", { name: "image.png thumbnail" })
        .getAttribute("src"),
    ).toBe("/image.png");

    rerender(
      <AssetThumbnail kind="video" src="/video.mp4" label="video.mp4" />,
    );
    expect(
      screen.getByLabelText("video.mp4 thumbnail unavailable"),
    ).toBeTruthy();
    expect(document.querySelector("video")).toBeNull();
  });

  it("renders a video thumbnail as an image instead of loading it as video media", () => {
    render(
      <AssetThumbnail
        kind="video"
        src="/video.mp4"
        thumbnailSrc="/video-cover.jpg"
        label="video.mp4"
      />,
    );

    expect(
      screen
        .getByRole("img", { name: "video.mp4 thumbnail" })
        .getAttribute("src"),
    ).toBe("/video-cover.jpg");
    expect(document.querySelector("video")).toBeNull();
  });

  it("extracts one disposable fixed-frame poster when a ready video has no Host poster", () => {
    const capture = installBrowserPosterCapture();
    const { container } = render(
      <AssetThumbnail
        kind="video"
        status="ready"
        src="/video.mp4"
        label="video.mp4"
      />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    readyVideoForPoster(video!);

    fireEvent.loadedMetadata(video!);
    expect(video!.currentTime).toBe(0);
    fireEvent.loadedData(video!);

    expect(capture.drawImage).toHaveBeenCalled();
    expect(capture.createObjectURL).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("img", { name: "video.mp4 thumbnail" })
        .getAttribute("src"),
    ).toBe("blob:https://clash.test/poster-1");
    expect(document.querySelector('img[src="/video.mp4"]')).toBeNull();
  });

  it("switches from a disposable browser poster to a Host poster that arrives later", () => {
    const capture = installBrowserPosterCapture();
    const { container, rerender } = render(
      <AssetThumbnail
        kind="video"
        status="ready"
        src="/video.mp4"
        label="video.mp4"
      />,
    );
    const video = container.querySelector("video")!;
    readyVideoForPoster(video);
    fireEvent.loadedMetadata(video);
    fireEvent.loadedData(video);

    rerender(
      <AssetThumbnail
        kind="video"
        status="ready"
        src="/video.mp4"
        thumbnailSrc="/host-poster.jpg"
        label="video.mp4"
      />,
    );

    const hostPoster = screen.getByRole("img", {
      name: "video.mp4 thumbnail",
    });
    expect(hostPoster.getAttribute("src")).toBe("/host-poster.jpg");
    fireEvent.load(hostPoster);
    expect(capture.revokeObjectURL).toHaveBeenCalledWith(
      "blob:https://clash.test/poster-1",
    );
  });

  it("falls back to fixed-frame extraction when the Host poster cannot load", () => {
    const { container } = render(
      <AssetThumbnail
        kind="video"
        status="ready"
        src="/video.mp4"
        thumbnailSrc="/broken-host-poster.jpg"
        label="video.mp4"
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "video.mp4 thumbnail" }));

    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "/video.mp4",
    );
    expect(container.querySelector('img[src="/video.mp4"]')).toBeNull();
  });

  it("does not publish an object URL when capture finishes after unmount", () => {
    const capture = installBrowserPosterCapture();
    let finishCapture: BlobCallback | undefined;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => {
        finishCapture = callback;
      },
    );
    const { container, unmount } = render(
      <AssetThumbnail
        kind="video"
        status="ready"
        src="/video.mp4"
        label="video.mp4"
      />,
    );
    const video = container.querySelector("video")!;
    readyVideoForPoster(video);
    fireEvent.loadedMetadata(video);
    fireEvent.loadedData(video);

    unmount();
    finishCapture?.(new Blob(["poster"], { type: "image/jpeg" }));

    expect(capture.createObjectURL).not.toHaveBeenCalled();
  });

  it("keeps the stable fallback when browser canvas capture is blocked", () => {
    const capture = installBrowserPosterCapture();
    capture.drawImage.mockImplementation(() => {
      throw new DOMException("Canvas is tainted", "SecurityError");
    });
    const { container } = render(
      <AssetThumbnail
        kind="video"
        status="ready"
        src="/video.mp4"
        label="video.mp4"
      />,
    );
    const video = container.querySelector("video")!;
    readyVideoForPoster(video);

    expect(() => fireEvent.loadedData(video)).not.toThrow();
    expect(capture.createObjectURL).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("video.mp4 thumbnail unavailable"),
    ).toBeTruthy();
  });

  it("does not decode video bytes before the Host reports them ready", () => {
    const { container, rerender } = render(
      <AssetThumbnail
        kind="video"
        status="downloading"
        src="/video.mp4"
        label="video.mp4"
      />,
    );
    expect(container.querySelector("video")).toBeNull();

    rerender(
      <AssetThumbnail
        kind="video"
        status="unavailable"
        src="/video.mp4"
        label="video.mp4"
      />,
    );
    expect(container.querySelector("video")).toBeNull();
  });

  it("uses a stable fallback when media cannot load", () => {
    render(
      <AssetThumbnail kind="image" src="/broken.png" label="broken.png" />,
    );

    fireEvent.error(screen.getByRole("img", { name: "broken.png thumbnail" }));

    expect(
      screen.getByLabelText("broken.png thumbnail unavailable"),
    ).toBeTruthy();
  });

  it("renders the Host-projected URL without rewriting it", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:49321",
    };

    render(
      <AssetThumbnail
        kind="image"
        src="/assets/uploads/image.png"
        label="image.png"
      />,
    );

    expect(
      screen
        .getByRole("img", { name: "image.png thumbnail" })
        .getAttribute("src"),
    ).toBe("/assets/uploads/image.png");
  });

  it("keeps audio as an icon instead of pretending it has a visual thumbnail", () => {
    render(<AssetThumbnail kind="audio" src="/audio.wav" label="audio.wav" />);

    expect(screen.getByLabelText("audio.wav audio")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("does not send a model playback URL through the image decoder", () => {
    render(
      <AssetThumbnail kind="model" src="/character.glb" label="Character" />,
    );

    expect(
      screen.getByLabelText("Character model thumbnail unavailable"),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
