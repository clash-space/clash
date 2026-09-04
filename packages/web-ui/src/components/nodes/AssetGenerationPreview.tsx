import { FilmStrip, ImageSquare } from "@phosphor-icons/react";

import { AgentMotion } from "../copilot/AgentMotion";

export type AssetGenerationKind = "image" | "video";

type AssetGenerationPreviewProps = {
  kind: AssetGenerationKind;
};

export function AssetGenerationPreview({ kind }: AssetGenerationPreviewProps) {
  const AssetIcon = kind === "video" ? FilmStrip : ImageSquare;

  return (
    <div
      className="clash-asset-generation-preview"
      role="status"
      aria-live="polite"
      aria-label={`Generating ${kind} asset`}
    >
      <div className="clash-asset-generation-preview__stage" aria-hidden="true">
        <AgentMotion
          state="working"
          className="clash-asset-generation-preview__agent"
        />
        <div className="clash-asset-generation-preview__output">
          {(["one", "two", "three"] as const).map((position) => (
            <span
              key={position}
              className={`clash-asset-generation-preview__card clash-asset-generation-preview__card--${position}`}
              data-generation-asset={kind}
            >
              <AssetIcon weight="bold" />
            </span>
          ))}
        </div>
      </div>
      <span className="clash-asset-generation-preview__label">
        Building {kind}
      </span>
    </div>
  );
}
