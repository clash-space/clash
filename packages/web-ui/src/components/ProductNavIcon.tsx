import type { SVGProps } from "react";

export type ProductNavIconKind = "home" | "projects" | "assets" | "store";

function ProductNavGlyph({ kind }: { kind: ProductNavIconKind }) {
  if (kind === "home") {
    return (
      <>
        <path d="m3.75 11.25 8.25-7.25 8.25 7.25" />
        <path
          data-slot="product-nav-signature"
          d="M6.25 9.5v8.25a2 2 0 0 0 2 2h4.25"
        />
        <path d="M15.75 19.75h.75a1.75 1.75 0 0 0 1.75-1.75V9.5" />
        <path d="M10 19.75v-5h4v2.25" />
      </>
    );
  }

  if (kind === "projects") {
    return (
      <>
        <path
          data-slot="product-nav-signature"
          d="M7 4.5h9.5a2 2 0 0 1 2 2V15"
        />
        <path d="M15.5 18.5H7a2 2 0 0 1-2-2v-10" />
        <path d="M8.5 8h6.25a2 2 0 0 1 2 2v4" opacity="0.62" />
        <path
          d="M13.75 16H8.5A1.5 1.5 0 0 1 7 14.5V8"
          opacity="0.62"
        />
      </>
    );
  }

  if (kind === "assets") {
    return (
      <>
        <path d="M8 4.5h10a2 2 0 0 1 2 2v8" opacity="0.62" />
        <path
          data-slot="product-nav-signature"
          d="M17.75 19.5H6a2 2 0 0 1-2-2V8.25a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6"
        />
        <circle cx="8" cy="10.25" r="1.25" />
        <path d="m5 17 4-4 3.1 2.75 2.15-2 3.25 3" />
      </>
    );
  }

  return (
    <>
      <path d="M8.25 4v4M15.75 4v4" />
      <path d="M6.5 8h11v2.25a5.5 5.5 0 0 1-11 0V8Z" />
      <path
        data-slot="product-nav-signature"
        d="M12 15.75V19a2 2 0 0 0 2 2h1.5"
      />
      <path d="M18.5 21h1.25" />
    </>
  );
}

export function ProductNavIcon({
  kind,
  ...props
}: SVGProps<SVGSVGElement> & { kind: ProductNavIconKind }) {
  return (
    <svg
      {...props}
      data-slot="product-nav-icon"
      data-kind={kind}
      data-icon-family="clash-open"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <ProductNavGlyph kind={kind} />
    </svg>
  );
}
