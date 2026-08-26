// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectBrowserSurfaces } from "./ProjectBrowserSurfaces";

afterEach(cleanup);

describe("ProjectBrowserSurfaces", () => {
  it("keeps every sidebar browser tab mounted while activating only the selected page", () => {
    const { container } = render(
      <ProjectBrowserSurfaces
        projectId="project-1"
        tabs={[
          { id: "browser-1", title: "One", url: "https://one.example" },
          { id: "browser-2", title: "Two", url: "https://two.example" },
        ]}
        activeBrowserId="browser-2"
        annotations={[]}
        activeAnnotationId={null}
        onTabChange={vi.fn()}
        onCreateAnnotation={vi.fn()}
        onSelectAnnotation={vi.fn()}
      />,
    );

    const slots = Array.from(
      container.querySelectorAll<HTMLElement>("[data-project-browser-slot]"),
    );
    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.dataset.active)).toEqual(["false", "true"]);
    expect(container.querySelectorAll("webview")).toHaveLength(2);
  });
});
