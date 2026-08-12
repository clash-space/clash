import { ClientOnly } from "../components/ClientOnly";
import { Suspense, lazy } from "react";

const Editor = lazy(() =>
  import("@clash/remotion-ui").then((m) => ({ default: m.Editor })),
);

export default function EditorStandaloneRoute() {
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
