// Barrel is intentionally empty — use subpath imports to avoid bundling the
// whole tree when only a few components are needed:
//   import LayoutContent from "@clash/web-ui/components/LayoutContent"
// This matters a lot for dev-server cold-start perf and for downstream
// platforms (Electron / Vite RSC) that evaluate modules eagerly.
export {};
