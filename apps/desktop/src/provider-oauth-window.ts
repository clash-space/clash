export interface ProviderOAuthAuthorizationRequest {
  verificationUri: string;
  callbackScheme: string;
}

export type ProviderOAuthAuthorizationResult =
  | { cancelled: true }
  | { cancelled: false; callbackUrl: string };

type ProviderOAuthNavigationListener = (
  event: { preventDefault(): void },
  url: string,
) => void;

export interface ProviderOAuthBrowserWindow {
  webContents: {
    on(event: "will-navigate" | "will-redirect", listener: ProviderOAuthNavigationListener): void;
    off(event: "will-navigate" | "will-redirect", listener: ProviderOAuthNavigationListener): void;
  };
  once(event: "closed", listener: () => void): void;
  loadURL(url: string): Promise<unknown>;
  isDestroyed(): boolean;
  destroy(): void;
}

export function isProviderOAuthCallbackUrl(url: string, callbackScheme: string): boolean {
  const normalizedScheme = callbackScheme.trim().toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(normalizedScheme)) return false;
  try {
    return new URL(url).protocol.toLowerCase() === `${normalizedScheme}:`;
  } catch {
    return false;
  }
}

export async function authorizeProviderInWindow(
  window: ProviderOAuthBrowserWindow,
  request: ProviderOAuthAuthorizationRequest,
): Promise<ProviderOAuthAuthorizationResult> {
  const authorizationUrl = new URL(request.verificationUri);
  if (authorizationUrl.protocol !== "https:" && authorizationUrl.protocol !== "http:") {
    throw new Error("Provider OAuth authorization URL must use HTTP or HTTPS.");
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(request.callbackScheme)) {
    throw new Error("Provider OAuth callback scheme is invalid.");
  }

  return new Promise<ProviderOAuthAuthorizationResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.webContents.off("will-navigate", handleNavigation);
      window.webContents.off("will-redirect", handleNavigation);
    };
    const finish = (result: ProviderOAuthAuthorizationResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const handleNavigation: ProviderOAuthNavigationListener = (event, url) => {
      if (!isProviderOAuthCallbackUrl(url, request.callbackScheme)) return;
      event.preventDefault();
      finish({ cancelled: false, callbackUrl: url });
      if (!window.isDestroyed()) window.destroy();
    };

    window.webContents.on("will-navigate", handleNavigation);
    window.webContents.on("will-redirect", handleNavigation);
    window.once("closed", () => finish({ cancelled: true }));
    void window.loadURL(authorizationUrl.toString()).catch((error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}
