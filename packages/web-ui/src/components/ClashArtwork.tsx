import type { SemanticTone } from "./ui/tone";
import { ArtworkSlot } from "./ui/artwork-slot";
import { BrandAsset, type BrandAssetName } from "./BrandAsset";

type ClashArtworkKind = "assets" | "store" | "action" | "skill";

function ArtworkGlyph({ kind }: { kind: ClashArtworkKind }) {
  if (kind === "assets") {
    return (
      <>
        <path
          d="M16 13.5h15a3.5 3.5 0 0 1 3.5 3.5v12"
          className="transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        />
        <g className="transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:translate-y-0.5 motion-reduce:transition-none">
          <rect x="11.5" y="18.5" width="24" height="17" rx="3.5" />
          <circle cx="18.5" cy="25" r="2" fill="currentColor" stroke="none" />
          <path d="m15 32 6-5 4 3 3-2.5 4 4.5" />
        </g>
      </>
    );
  }

  if (kind === "store") {
    return (
      <>
        <rect
          x="11.5"
          y="11.5"
          width="10"
          height="10"
          rx="2.75"
          className="transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        />
        <rect
          x="26.5"
          y="11.5"
          width="10"
          height="10"
          rx="2.75"
          className="transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        />
        <rect
          x="11.5"
          y="26.5"
          width="10"
          height="10"
          rx="2.75"
          className="transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:translate-y-0.5 motion-reduce:transition-none"
        />
        <path d="M27 31.5h-5.5m10-10V27" />
        <circle cx="31.5" cy="31.5" r="5" />
      </>
    );
  }

  if (kind === "action") {
    return (
      <>
        <path d="M13 24h5m12 0h5M24 13v5m0 12v5" />
        <circle cx="24" cy="24" r="7" />
        <path d="m25 19-4 6h4l-2 4" />
      </>
    );
  }

  return (
    <>
      <path d="M14 14.5h13a6 6 0 0 1 6 6v14H20a6 6 0 0 0-6 0z" />
      <path d="M20 14.5v20m4-14h5m-5 5h5" />
    </>
  );
}

export function ClashArtwork({
  kind,
  size = "md",
  tone,
}: {
  kind: ClashArtworkKind;
  size?: "md" | "lg";
  tone?: SemanticTone;
}) {
  return (
    <ArtworkSlot
      slot="clash-artwork"
      data-kind={kind}
      data-tone={tone}
      size={size === "lg" ? "lg" : "md"}
      className="text-content-primary"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 48 48"
        className={size === "lg" ? "size-10" : "size-8"}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ArtworkGlyph kind={kind} />
        </g>
      </svg>
    </ArtworkSlot>
  );
}

export function ClashPublisherArtwork({
  assetName,
  src,
  label,
  tone,
}: ({
  assetName: BrandAssetName;
  src?: never;
} | {
  assetName?: never;
  src: string;
}) & {
  label: string;
  tone?: SemanticTone;
}) {
  return (
    <ArtworkSlot
      slot="publisher-artwork"
      data-tone={tone}
    >
      {assetName ? (
        <BrandAsset
          name={assetName}
          alt={`${label} mark`}
          className="size-9 object-contain"
        />
      ) : (
        <img src={src} alt={`${label} mark`} className="size-9 object-contain" />
      )}
    </ArtworkSlot>
  );
}

export function ProjectEmptyArtwork({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      data-ui="brand-artwork"
      data-slot="project-empty-artwork"
      viewBox="0 0 512 512"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g data-slot="project-empty-avatar">
        <path
          d="M 452.6 234.5
             L 452.6 95.3
             A 56.8 58.6 0 0 0 395.8 36.8
             L 117.4 36.8
             A 58.6 58.6 0 0 0 58.6 95.3
             L 58.6 384.2
             A 58 57.4 0 0 0 117.4 441.6
             L 333.1 441.6"
          stroke="currentColor"
          strokeWidth="30"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <ellipse cx="183" cy="210" rx="27.3" ry="47.6" fill="currentColor" />
        <ellipse cx="290" cy="210" rx="27.3" ry="47.6" fill="currentColor" />
        <rect
          x="392.3"
          y="253.1"
          width="51"
          height="215.8"
          rx="25.5"
          fill="var(--clash-agent-avatar-accent, #ff6b50)"
          transform="rotate(26.06 417.8 361)"
        />
      </g>
    </svg>
  );
}
