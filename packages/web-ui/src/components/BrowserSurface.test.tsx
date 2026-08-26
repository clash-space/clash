// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSurface, normalizeBrowserUrl } from "./BrowserSurface";

afterEach(cleanup);

describe("BrowserSurface", () => {
  it("uses Backchat address normalization and exposes real browser controls", () => {
    expect(normalizeBrowserUrl("example.test/docs")).toBe(
      "https://example.test/docs",
    );
    expect(normalizeBrowserUrl("find this phrase")).toBe(
      "https://www.google.com/search?q=find%20this%20phrase",
    );
    expect(normalizeBrowserUrl("ok", "en-US")).toBe(
      "https://www.google.com/search?q=ok",
    );

    render(
      <BrowserSurface
        projectId="project-1"
        tab={{
          id: "browser-1",
          title: "New Browser",
          url: "about:blank",
        }}
        annotations={[]}
        activeAnnotationId={null}
        onTabChange={vi.fn()}
        onCreateAnnotation={vi.fn()}
        onSelectAnnotation={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Forward" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annotate page" })).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Browser address" }),
    ).toBeTruthy();
  });

  it("submits Chinese omnibox text to a reachable localized search", async () => {
    const language = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("zh-CN");
    const { container } = render(
      <BrowserSurface
        projectId="project-1"
        tab={{
          id: "browser-1",
          title: "New Browser",
          url: "about:blank",
        }}
        annotations={[]}
        activeAnnotationId={null}
        onTabChange={vi.fn()}
        onCreateAnnotation={vi.fn()}
        onSelectAnnotation={vi.fn()}
      />,
    );
    const webview = container.querySelector("webview") as HTMLElement & {
      loadURL(url: string): Promise<void>;
    };
    webview.loadURL = vi.fn().mockResolvedValue(undefined);

    const address = screen.getByRole("textbox", { name: "Browser address" });
    fireEvent.change(address, { target: { value: "这项任务" } });
    fireEvent.submit(address.closest("form")!);

    await waitFor(() =>
      expect(webview.loadURL).toHaveBeenCalledWith(
        "https://www.baidu.com/s?wd=%E8%BF%99%E9%A1%B9%E4%BB%BB%E5%8A%A1",
      ),
    );
    language.mockRestore();
  });

  it("maps Backchat viewport coordinates to positioned annotation markers", () => {
    const { container } = render(
      <BrowserSurface
        projectId="project-1"
        tab={{
          id: "browser-1",
          title: "Clash docs",
          url: "https://clash.example/docs",
        }}
        annotations={[
          {
            id: "annotation-browser-1",
            kind: "agent-annotation",
            note: "Clarify this action.",
            target: {
              projectId: "project-1",
              surface: "browser",
              surfaceId: "browser-1",
              surfaceLabel: "Clash docs",
              objectId: "#hero-cta",
              objectType: "browser-element",
              objectLabel: "Start creating",
              objectPath: "browsers/browser-1/elements/%23hero-cta",
              capabilities: ["read"],
              browser: {
                kind: "element",
                url: "https://clash.example/docs",
                title: "Clash docs",
                selector: "#hero-cta",
                tagName: "a",
                rect: { x: 120, y: 240, width: 160, height: 40 },
                viewport: {
                  width: 1280,
                  height: 720,
                  devicePixelRatio: 2,
                },
              },
            },
          },
        ]}
        activeAnnotationId="annotation-browser-1"
        onTabChange={vi.fn()}
        onCreateAnnotation={vi.fn()}
        onSelectAnnotation={vi.fn()}
      />,
    );

    const marker = container.querySelector<HTMLElement>(
      '[data-browser-annotation-marker="annotation-browser-1"]',
    );
    expect(marker?.style.left).toBe("120px");
    expect(marker?.style.top).toBe("240px");
    expect(marker?.style.width).toBe("160px");
    expect(marker?.style.height).toBe("40px");
    const browserViewport = marker?.parentElement?.parentElement;
    expect(browserViewport?.className).toContain("overflow-hidden");
  });

  it("renders page load failures through the shared feedback contract", async () => {
    const { container } = render(
      <BrowserSurface
        projectId="project-1"
        tab={{
          id: "browser-1",
          title: "Clash docs",
          url: "https://clash.example/docs",
        }}
        annotations={[]}
        activeAnnotationId={null}
        onTabChange={vi.fn()}
        onCreateAnnotation={vi.fn()}
        onSelectAnnotation={vi.fn()}
      />,
    );
    const webview = container.querySelector("webview");
    const event = new Event("did-fail-load") as Event & {
      errorDescription: string;
    };
    event.errorDescription = "The page stopped responding";
    webview?.dispatchEvent(event);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-ui", "feedback");
    expect(alert).toHaveAttribute("data-tone", "error");
    expect(alert).toHaveTextContent("The page stopped responding");
  });

  it("queues the Backchat DOM snapshot when the user clicks a page element", async () => {
    const onCreateAnnotation = vi.fn(() => "annotation-browser-1");
    const { container } = render(
      <BrowserSurface
        projectId="project-1"
        tab={{
          id: "browser-1",
          title: "Clash docs",
          url: "https://clash.example/docs",
        }}
        annotations={[]}
        activeAnnotationId={null}
        onTabChange={vi.fn()}
        onCreateAnnotation={onCreateAnnotation}
        onSelectAnnotation={vi.fn()}
      />,
    );
    const webview = container.querySelector("webview") as HTMLElement & {
      canGoBack(): boolean;
      canGoForward(): boolean;
      getURL(): string;
      getTitle(): string;
      executeJavaScript<T>(): Promise<T>;
    };
    webview.canGoBack = () => false;
    webview.canGoForward = () => false;
    webview.getURL = () => "https://clash.example/docs";
    webview.getTitle = () => "Clash docs";
    webview.executeJavaScript = async <T,>() =>
      ({
        kind: "element",
        url: "https://clash.example/docs",
        title: "Clash docs",
        selector: "#hero-cta",
        tagName: "a",
        text: "Start creating",
        rect: { x: 120, y: 240, width: 160, height: 40 },
        viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
      }) as T;
    fireEvent(webview, new Event("dom-ready"));

    const annotate = screen.getByRole("button", { name: "Annotate page" });
    await waitFor(() => expect(annotate.hasAttribute("disabled")).toBe(false));
    fireEvent.click(annotate);
    const overlay = screen.getByLabelText("Browser annotation canvas");
    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerId: 1,
      clientX: 128,
      clientY: 248,
    });
    fireEvent.pointerUp(overlay, {
      button: 0,
      pointerId: 1,
      clientX: 128,
      clientY: 248,
    });

    await waitFor(() => expect(onCreateAnnotation).toHaveBeenCalledOnce());
    expect(onCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        surface: "browser",
        surfaceId: "browser-1",
        objectId: "#hero-cta",
        browser: expect.objectContaining({
          kind: "element",
          selector: "#hero-cta",
        }),
      }),
    );
  });
});
