import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";

const Editor = lazy(() =>
  import("@master-clash/remotion-ui").then((m) => ({ default: m.Editor })),
);

export const Route = createFileRoute("/_app/editor-standalone")({
  component: EditorStandaloneRoute,
});

function ClientOnly({
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

function EditorStandaloneRoute() {
  return (
    <div className="w-screen h-screen">
      <ClientOnly fallback={<div className="p-8">Loading editor…</div>}>
        <Suspense fallback={<div className="p-8">Loading editor…</div>}>
          <Editor />
        </Suspense>
      </ClientOnly>
    </div>
  );
}
