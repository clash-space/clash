import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ChatCenteredDots,
  CircleNotch,
} from "@phosphor-icons/react";
import type {
  AgentAnnotationBrowserContext,
  AgentAnnotationDraft,
  AgentAnnotationTarget,
} from "@clash/shared-types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { IconButton } from "./ui/icon-button";
import { InlineAlert } from "./ui/feedback";
import { Input } from "./ui/input";
import { Tooltip } from "./ui/tooltip";
import type { ProjectBrowserTab } from "./ProjectWorkspaceNavigator";
import type { BrowserAgentContext } from "../lib/copilotWorkspaceContext";

/** Backchat's omnibox rule: preserve URLs, promote host-like input, search text. */
export function normalizeBrowserUrl(
  raw: string,
  language = typeof navigator === "undefined" ? "en-US" : navigator.language,
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "about:blank";
  if (/^(https?|file|about):/i.test(trimmed)) return trimmed;
  if (/^\//.test(trimmed)) return `file://${trimmed}`;
  if (
    /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z0-9-]+)(?::\d+)?(?:[/?#].*)?$/i.test(
      trimmed,
    )
  ) {
    return `https://${trimmed}`;
  }
  if (/^zh(?:-(?:cn|sg|hans))?$/i.test(language)) {
    return `https://www.baidu.com/s?wd=${encodeURIComponent(trimmed)}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function browserAddressLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
    }
  } catch {
    // Preserve incomplete omnibox input.
  }
  return url;
}

type BrowserElementContext = Extract<
  AgentAnnotationBrowserContext,
  { kind: "element" }
>;

interface BrowserWebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
  getURL(): string;
  getTitle(): string;
  executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
}

interface BrowserNavigationEvent extends Event {
  url?: string;
  title?: string;
  errorCode?: number;
  errorDescription?: string;
}

interface BrowserPoint {
  x: number;
  y: number;
}

interface BrowserRegionDrag {
  start: BrowserPoint;
  current: BrowserPoint;
}

const ANNOTATION_DRAG_THRESHOLD = 6;
// Electron types `allowpopups` as boolean, while React only preserves this
// custom-element attribute when it receives a string.
const WEBVIEW_ALLOW_POPUPS = "true" as unknown as boolean;

function browserPageKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function browserElementLabel(element: BrowserElementContext): string {
  const text = element.text?.replace(/\s+/g, " ").trim();
  if (!text) return element.selector;
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function positionedRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function regionFromDrag(drag: BrowserRegionDrag): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: Math.min(drag.start.x, drag.current.x),
    y: Math.min(drag.start.y, drag.current.y),
    width: Math.abs(drag.current.x - drag.start.x),
    height: Math.abs(drag.current.y - drag.start.y),
  };
}

function elementAtPointScript(point: BrowserPoint): string {
  const x = rounded(Number.isFinite(point.x) ? point.x : 0);
  const y = rounded(Number.isFinite(point.y) ? point.y : 0);
  return String.raw`(() => {
    const element = document.elementFromPoint(${x}, ${y});
    if (!(element instanceof Element)) return null;
    const view = element.ownerDocument.defaultView || window;
    const truncate = (value, max) => {
      const text = String(value ?? "").replace(/\s+/g, " ").trim();
      return text.length > max ? text.slice(0, max - 1) + "…" : text;
    };
    const escapeCss = (value) => {
      try { return view.CSS.escape(value); }
      catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
    };
    const segmentFor = (node) => {
      if (node.id) return "#" + escapeCss(node.id);
      const testId = node.getAttribute("data-testid");
      if (testId) return '[data-testid="' + escapeCss(testId) + '"]';
      let segment = node.tagName.toLowerCase();
      const classes = Array.from(node.classList)
        .filter((name) => name.length > 0 && name.length <= 48)
        .slice(0, 2);
      if (classes.length) segment += classes.map((name) => "." + escapeCss(name)).join("");
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === node.tagName);
        if (siblings.length > 1) segment += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      return segment;
    };
    const selectorParts = [];
    let current = element;
    while (current && current.nodeType === 1) {
      selectorParts.unshift(segmentFor(current));
      if (current.id || current.hasAttribute("data-testid")) break;
      current = current.parentElement;
    }
    const domParts = [];
    current = element;
    while (current && current.nodeType === 1) {
      domParts.unshift(current.tagName.toLowerCase());
      current = current.parentElement;
    }
    const blockedAttributes = new Set(["value", "srcdoc", "nonce", "integrity"]);
    const attributes = {};
    for (const attribute of Array.from(element.attributes).slice(0, 24)) {
      if (!blockedAttributes.has(attribute.name.toLowerCase())) {
        attributes[attribute.name] = truncate(attribute.value, 300);
      }
    }
    const clone = element.cloneNode(true);
    if (clone instanceof HTMLElement) {
      for (const formNode of [clone, ...clone.querySelectorAll("input, textarea, select, option")]) {
        formNode.removeAttribute("value");
        formNode.removeAttribute("checked");
        formNode.removeAttribute("selected");
      }
    }
    const isPassword = element instanceof HTMLInputElement && element.type === "password";
    const text = isPassword ? "" : truncate(element.innerText || element.textContent, 1200);
    const rect = element.getBoundingClientRect();
    const computed = view.getComputedStyle(element);
    return {
      kind: "element",
      url: truncate(view.location.href, 2048),
      title: truncate(document.title, 300),
      selector: selectorParts.join(" > ") || element.tagName.toLowerCase(),
      domPath: domParts.join(" > "),
      tagName: element.tagName.toLowerCase(),
      ...(element.id ? { id: truncate(element.id, 200) } : {}),
      classNames: Array.from(element.classList).slice(0, 16).map((name) => truncate(name, 120)),
      ...(element.getAttribute("role") ? { role: truncate(element.getAttribute("role"), 120) } : {}),
      ...(element.getAttribute("aria-label") ? { ariaLabel: truncate(element.getAttribute("aria-label"), 300) } : {}),
      ...(text ? { text } : {}),
      attributes,
      ...(clone instanceof HTMLElement ? { outerHtml: truncate(clone.outerHTML, 4000) } : {}),
      computedStyles: {
        color: computed.color,
        background: computed.backgroundColor,
        opacity: computed.opacity,
        "font-family": computed.fontFamily,
        "font-size": computed.fontSize,
        "font-weight": computed.fontWeight,
        "line-height": computed.lineHeight,
        "border-radius": computed.borderRadius,
      },
      rect: {
        x: Math.round(rect.x * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      },
      viewport: {
        width: view.innerWidth,
        height: view.innerHeight,
        devicePixelRatio: view.devicePixelRatio || 1,
      },
    };
  })()`;
}

function browserAgentContextScript(): string {
  return String.raw`(() => {
    const truncate = (value, max) => {
      const text = String(value ?? "").replace(/\s+/g, " ").trim();
      return text.length > max ? text.slice(0, max - 1) + "…" : text;
    };
    const escapeCss = (value) => {
      try { return CSS.escape(value); }
      catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
    };
    const selectorFor = (element) => {
      if (element.id) return "#" + escapeCss(element.id);
      const testId = element.getAttribute("data-testid");
      if (testId) return '[data-testid="' + escapeCss(testId) + '"]';
      const parts = [];
      let current = element;
      while (current && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (sibling) => sibling.tagName === current.tagName,
          );
          if (siblings.length > 1) {
            part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
          }
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    };
    const interactiveElements = Array.from(document.querySelectorAll(
      'a[href], button, input:not([type="password"]), textarea, select, [role="button"], [role="link"]',
    ))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .slice(0, 80)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        label: truncate(
          element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.getAttribute("placeholder") ||
            element.innerText ||
            element.textContent ||
            element.getAttribute("name"),
          200,
        ),
        selector: selectorFor(element),
      }))
      .filter((element) => element.label);
    return {
      url: truncate(location.href, 2048),
      title: truncate(document.title, 300),
      text: truncate(document.body?.innerText || document.body?.textContent, 6000),
      interactiveElements,
    };
  })()`;
}

function browserAnnotationTarget(
  projectId: string,
  tab: ProjectBrowserTab,
  browser: AgentAnnotationBrowserContext,
): AgentAnnotationTarget {
  const isElement = browser.kind === "element";
  const objectId = isElement
    ? browser.selector
    : `region-${rounded(browser.rect.x)}-${rounded(browser.rect.y)}-${rounded(browser.rect.width)}-${rounded(browser.rect.height)}`;
  const objectLabel = isElement
    ? browserElementLabel(browser)
    : `Region ${Math.round(browser.rect.width)}×${Math.round(browser.rect.height)}`;
  return {
    projectId,
    surface: "browser",
    surfaceId: tab.id,
    surfaceLabel: browser.title || tab.title,
    objectId,
    objectType: isElement ? "browser-element" : "browser-region",
    objectLabel,
    objectPath: `browsers/${tab.id}/${isElement ? "elements" : "regions"}/${encodeURIComponent(objectId)}`,
    capabilities: ["read"],
    browser,
  };
}

function webviewReady(
  webview: BrowserWebviewElement | null,
): webview is BrowserWebviewElement {
  return Boolean(webview && typeof webview.executeJavaScript === "function");
}

export function BrowserSurface({
  projectId,
  tab,
  headerEndInset = 0,
  annotations,
  activeAnnotationId,
  onTabChange,
  onCreateAnnotation,
  onSelectAnnotation,
  onAgentContextChange,
}: {
  projectId: string;
  tab: ProjectBrowserTab;
  headerEndInset?: number;
  annotations: readonly AgentAnnotationDraft[];
  activeAnnotationId: string | null;
  onTabChange: (
    patch: Partial<Pick<ProjectBrowserTab, "title" | "url">>,
  ) => void;
  onCreateAnnotation: (target: AgentAnnotationTarget) => string;
  onSelectAnnotation: (annotationId: string) => void;
  onAgentContextChange?: (
    browserId: string,
    context: BrowserAgentContext,
  ) => void;
}) {
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingPointRef = useRef<BrowserPoint | null>(null);
  const dragRef = useRef<BrowserRegionDrag | null>(null);
  const [urlInput, setUrlInput] = useState(tab.url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [hover, setHover] = useState<BrowserElementContext | null>(null);
  const [drag, setDrag] = useState<BrowserRegionDrag | null>(null);

  const publishAgentContext = useCallback(async () => {
    const webview = webviewRef.current;
    if (!onAgentContextChange || !webviewReady(webview)) return;
    try {
      const context = await webview.executeJavaScript<BrowserAgentContext>(
        browserAgentContextScript(),
      );
      onAgentContextChange(tab.id, context);
    } catch {
      onAgentContextChange(tab.id, {
        url: webview.getURL?.() || tab.url,
        title: webview.getTitle?.() || tab.title,
        text: "",
        interactiveElements: [],
      });
    }
  }, [onAgentContextChange, tab.id, tab.title, tab.url]);

  const updateNavigationState = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      setCanBack(webview.canGoBack());
      setCanForward(webview.canGoForward());
    } catch {
      setCanBack(false);
      setCanForward(false);
    }
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const onNavigation = (rawEvent: Event) => {
      const event = rawEvent as BrowserNavigationEvent;
      const nextUrl = event.url || webview.getURL?.() || tab.url;
      setUrlInput(nextUrl);
      onTabChange({ url: nextUrl });
      setLoadError(null);
      setAnnotating(false);
      setHover(null);
      updateNavigationState();
      void publishAgentContext();
    };
    const onTitle = (rawEvent: Event) => {
      const event = rawEvent as BrowserNavigationEvent;
      const title = event.title || webview.getTitle?.();
      if (title) onTabChange({ title });
    };
    const onReady = () => {
      setReady(true);
      updateNavigationState();
      const nextUrl = webview.getURL?.();
      const title = webview.getTitle?.();
      onTabChange({
        ...(nextUrl ? { url: nextUrl } : {}),
        ...(title ? { title } : {}),
      });
      void publishAgentContext();
    };
    const onLoadStart = () => {
      setLoading(true);
      setReady(false);
    };
    const onLoadStop = () => {
      setLoading(false);
      setReady(true);
      updateNavigationState();
      void publishAgentContext();
    };
    const onLoadFailure = (rawEvent: Event) => {
      const event = rawEvent as BrowserNavigationEvent;
      if (event.errorCode === -3) return;
      setLoading(false);
      setLoadError(event.errorDescription || "Page could not be loaded");
    };
    webview.addEventListener("dom-ready", onReady);
    webview.addEventListener("did-start-loading", onLoadStart);
    webview.addEventListener("did-stop-loading", onLoadStop);
    webview.addEventListener("did-navigate", onNavigation);
    webview.addEventListener("did-navigate-in-page", onNavigation);
    webview.addEventListener("did-redirect-navigation", onNavigation);
    webview.addEventListener("page-title-updated", onTitle);
    webview.addEventListener("did-fail-load", onLoadFailure);
    return () => {
      webview.removeEventListener("dom-ready", onReady);
      webview.removeEventListener("did-start-loading", onLoadStart);
      webview.removeEventListener("did-stop-loading", onLoadStop);
      webview.removeEventListener("did-navigate", onNavigation);
      webview.removeEventListener("did-navigate-in-page", onNavigation);
      webview.removeEventListener("did-redirect-navigation", onNavigation);
      webview.removeEventListener("page-title-updated", onTitle);
      webview.removeEventListener("did-fail-load", onLoadFailure);
    };
  }, [onTabChange, publishAgentContext, tab.url, updateNavigationState]);

  useEffect(
    () => () => {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
      }
    },
    [],
  );

  const navigate = useCallback(
    (raw: string) => {
      const nextUrl = normalizeBrowserUrl(raw);
      setUrlInput(nextUrl);
      setLoadError(null);
      onTabChange({ url: nextUrl });
      const webview = webviewRef.current;
      if (webview && typeof webview.loadURL === "function") {
        void webview.loadURL(nextUrl).catch((error: unknown) => {
          setLoadError(error instanceof Error ? error.message : String(error));
        });
      }
    },
    [onTabChange],
  );

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    navigate(urlInput);
  };

  const pointFromEvent = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): BrowserPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const inspectPoint = useCallback(async (point: BrowserPoint) => {
    const webview = webviewRef.current;
    if (!webviewReady(webview)) return null;
    return webview.executeJavaScript<BrowserElementContext | null>(
      elementAtPointScript(point),
    );
  }, []);

  const requestHover = useCallback(
    (point: BrowserPoint) => {
      pendingPointRef.current = point;
      if (hoverFrameRef.current !== null) return;
      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        const next = pendingPointRef.current;
        if (!next) return;
        void inspectPoint(next)
          .then(setHover)
          .catch(() => setHover(null));
      });
    },
    [inspectPoint],
  );

  const createElementAnnotation = useCallback(
    async (point: BrowserPoint) => {
      const element = await inspectPoint(point);
      if (!element) return;
      onCreateAnnotation(browserAnnotationTarget(projectId, tab, element));
      setHover(element);
    },
    [inspectPoint, onCreateAnnotation, projectId, tab],
  );

  const createRegionAnnotation = useCallback(
    (region: ReturnType<typeof regionFromDrag>) => {
      if (region.width <= 0 || region.height <= 0) return;
      const webview = webviewRef.current;
      const url = webview?.getURL?.() || tab.url;
      const title = webview?.getTitle?.() || tab.title;
      const viewport = {
        width: Math.max(1, webview?.clientWidth || 1),
        height: Math.max(1, webview?.clientHeight || 1),
        devicePixelRatio: window.devicePixelRatio || 1,
      };
      onCreateAnnotation(
        browserAnnotationTarget(projectId, tab, {
          kind: "region",
          url,
          title,
          rect: region,
          viewport,
        }),
      );
    },
    [onCreateAnnotation, projectId, tab],
  );

  const pageAnnotations = useMemo(() => {
    const currentPage = browserPageKey(tab.url);
    return annotations.filter((annotation) => {
      const browser = annotation.target.browser;
      return (
        annotation.target.surface === "browser" &&
        annotation.target.surfaceId === tab.id &&
        browser &&
        browserPageKey(browser.url) === currentPage
      );
    });
  }, [annotations, tab.id, tab.url]);

  const selection = drag ? regionFromDrag(drag) : null;

  return (
    <section
      aria-label={`Browser: ${tab.title}`}
      className="flex h-full min-h-0 flex-col overflow-hidden border-r border-warm-border bg-warm-page"
      data-project-browser={tab.id}
    >
      <div
        data-browser-toolbar=""
        className="flex h-10 shrink-0 items-center gap-1 border-b border-warm-border bg-warm-page px-2"
        style={{ paddingRight: headerEndInset || undefined }}
      >
        <Tooltip label="Back">
          <IconButton
            label="Back"
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            size="sm"
            shape="rounded"
            disabled={!canBack}
            onClick={() => webviewRef.current?.goBack()}
            className="h-7 min-h-7 w-7 min-w-7 text-content-secondary hover:bg-warm-hover hover:text-content-primary"
          />
        </Tooltip>
        <Tooltip label="Forward">
          <IconButton
            label="Forward"
            icon={<ArrowRight className="h-3.5 w-3.5" />}
            size="sm"
            shape="rounded"
            disabled={!canForward}
            onClick={() => webviewRef.current?.goForward()}
            className="h-7 min-h-7 w-7 min-w-7 text-content-secondary hover:bg-warm-hover hover:text-content-primary"
          />
        </Tooltip>
        <Tooltip label="Reload">
          <IconButton
            label="Reload"
            icon={
              loading ? (
                <CircleNotch className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <ArrowClockwise className="h-3.5 w-3.5" />
              )
            }
            size="sm"
            shape="rounded"
            onClick={() => webviewRef.current?.reload()}
            className="h-7 min-h-7 w-7 min-w-7 text-content-secondary hover:bg-warm-hover hover:text-content-primary"
          />
        </Tooltip>
        <form className="min-w-0 flex-1 px-1" onSubmit={submitAddress}>
          <Input
            aria-label="Browser address"
            value={
              urlFocused || urlInput === "about:blank"
                ? urlInput === "about:blank"
                  ? ""
                  : urlInput
                : browserAddressLabel(urlInput)
            }
            onChange={(event) => setUrlInput(event.target.value)}
            onFocus={(event) => {
              setUrlFocused(true);
              event.currentTarget.select();
            }}
            onBlur={() => setUrlFocused(false)}
            placeholder="Enter URL or search"
            className="h-7 w-full rounded-md border border-warm-border bg-warm-surface px-2.5 text-xs text-content-primary shadow-none placeholder:text-content-muted focus-visible:ring-1 focus-visible:ring-ring/60"
          />
        </form>
        <Tooltip label="Open in default browser">
          <IconButton
            label="Open in default browser"
            icon={<ArrowSquareOut className="h-3.5 w-3.5" />}
            size="sm"
            shape="rounded"
            disabled={!/^https?:/i.test(tab.url)}
            onClick={() => {
              const openExternal = globalThis.__CLASH_DESKTOP__?.openExternal;
              if (openExternal) void openExternal(tab.url);
              else window.open(tab.url, "_blank", "noopener,noreferrer");
            }}
            className="h-7 min-h-7 w-7 min-w-7 text-content-secondary hover:bg-warm-hover hover:text-content-primary"
          />
        </Tooltip>
        <Tooltip label={annotating ? "Stop annotating" : "Annotate page"}>
          <IconButton
            label="Annotate page"
            aria-pressed={annotating}
            icon={<ChatCenteredDots className="h-3.5 w-3.5" weight="duotone" />}
            size="sm"
            shape="rounded"
            disabled={!ready && tab.url !== "about:blank"}
            onClick={() => {
              setAnnotating((current) => !current);
              setHover(null);
              setDrag(null);
              dragRef.current = null;
            }}
            className="h-7 min-h-7 w-7 min-w-7 text-content-secondary hover:bg-warm-hover hover:text-content-primary aria-pressed:bg-brand/[0.12] aria-pressed:text-brand"
          />
        </Tooltip>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-warm-surface">
        {/* Electron's webview is enabled only in the desktop host. */}
        <webview
          ref={webviewRef}
          src={normalizeBrowserUrl(tab.url)}
          partition="persist:clash-browser"
          allowpopups={WEBVIEW_ALLOW_POPUPS}
          webpreferences="contextIsolation=yes"
          className="h-full w-full bg-warm-surface"
        />
        {loadError ? (
          <InlineAlert
            tone="error"
            title="Page could not load"
            message={loadError}
            className="absolute inset-x-4 top-4 shadow-raised"
          />
        ) : null}
        {annotating ? (
          <div
            aria-label="Browser annotation canvas"
            className="absolute inset-0 z-20 cursor-crosshair touch-none"
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const point = pointFromEvent(event);
              const next = { start: point, current: point };
              dragRef.current = next;
              setDrag(next);
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              const point = pointFromEvent(event);
              const current = dragRef.current;
              if (current) {
                const next = { ...current, current: point };
                dragRef.current = next;
                setDrag(next);
                return;
              }
              requestHover(point);
            }}
            onPointerUp={(event) => {
              if (event.button !== 0) return;
              const current = dragRef.current;
              dragRef.current = null;
              setDrag(null);
              if (!current) return;
              const completed = { ...current, current: pointFromEvent(event) };
              const region = regionFromDrag(completed);
              if (
                Math.hypot(
                  completed.current.x - completed.start.x,
                  completed.current.y - completed.start.y,
                ) >= ANNOTATION_DRAG_THRESHOLD
              ) {
                createRegionAnnotation(region);
              } else {
                void createElementAnnotation(completed.current);
              }
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              setDrag(null);
            }}
            onPointerLeave={() => {
              if (!dragRef.current) setHover(null);
            }}
          >
            {!selection && hover ? (
              <div
                className="pointer-events-none absolute border-2 border-brand bg-brand/10"
                style={positionedRect(hover.rect)}
              >
                <span className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full border-2 border-warm-surface bg-brand text-[10px] font-semibold text-white shadow-sm">
                  +
                </span>
                <span className="absolute bottom-[calc(100%+4px)] left-0 max-w-[26rem] truncate rounded bg-content-primary px-1.5 py-0.5 font-mono text-[10px] text-warm-page shadow-sm">
                  {browserElementLabel(hover)}
                </span>
              </div>
            ) : null}
            {selection && selection.width > 0 && selection.height > 0 ? (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-brand bg-brand/10"
                style={positionedRect(selection)}
              />
            ) : null}
          </div>
        ) : null}
        {pageAnnotations.length > 0 ? (
          <div className="pointer-events-none absolute inset-0 z-30">
            {pageAnnotations.map((annotation, index) => {
              const rect = annotation.target.browser?.rect;
              if (!rect) return null;
              const active = annotation.id === activeAnnotationId;
              return (
                <div
                  key={annotation.id}
                  data-browser-annotation-marker={annotation.id}
                  className={`pointer-events-none absolute border-2 ${
                    annotation.target.browser?.kind === "region"
                      ? "border-dashed"
                      : ""
                  } ${active ? "border-brand bg-brand/15" : "border-brand/80 bg-brand/10"}`}
                  style={positionedRect(rect)}
                >
                  <button
                    type="button"
                    data-agent-annotation-anchor={annotation.id}
                    aria-label={`Open browser annotation ${index + 1}`}
                    className="pointer-events-auto absolute -right-3 -top-3 grid h-6 w-6 place-items-center rounded-full border-2 border-warm-surface bg-brand text-[10px] font-semibold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => onSelectAnnotation(annotation.id)}
                  >
                    {index + 1}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
