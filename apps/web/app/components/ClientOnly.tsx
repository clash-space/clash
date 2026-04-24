import { useEffect, useState, type ReactNode } from "react";

/**
 * Render children only on the client — bails out of SSR for components
 * that touch `window`/`document` or dynamic imports that include WASM.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : <>{fallback}</>;
}
