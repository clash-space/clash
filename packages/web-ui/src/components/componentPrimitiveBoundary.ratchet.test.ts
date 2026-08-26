import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const componentsRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(componentsRoot, "../../../..");
const sourceRoots = [
  resolve(repositoryRoot, "packages/web-ui/src/components"),
  resolve(repositoryRoot, "apps/web/app"),
];

const nativeControlNames = new Set(["button", "select", "textarea"]);
const complexRoles = new Set([
  "alertdialog",
  "combobox",
  "dialog",
  "listbox",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "tablist",
  "tree",
  "treeitem",
]);

type BoundaryKind = `native:${string}` | `role:${string}`;

/**
 * Existing debt only. Entries grant a file permission to contain a legacy
 * primitive kind; they deliberately do not pin counts or line numbers.
 * Removing the last occurrence lets us delete that permission permanently.
 */
const legacyAllowlist: Readonly<Record<string, readonly BoundaryKind[]>> = {
  "packages/web-ui/src/components/BrowserSurface.tsx": ["native:button"],
  "packages/web-ui/src/components/DesktopAutoHideSidebar.tsx": [
    "native:button",
  ],
  "packages/web-ui/src/components/GlobalAssetsClient.tsx": ["native:button"],
  "packages/web-ui/src/components/ProjectDirectorStageSurface.tsx": [
    "native:button",
  ],
  "packages/web-ui/src/components/ProjectEditor.tsx": ["native:button"],
  "packages/web-ui/src/components/ProjectWorkspaceNavigator.tsx": [
    "native:button",
  ],
  "packages/web-ui/src/components/TopNavigation.tsx": ["native:button"],
  "packages/web-ui/src/components/copilot/AgentAnnotationBlock.tsx": [
    "native:button",
  ],
  "packages/web-ui/src/components/copilot/AgentSelectionAnnotationOverlay.tsx":
    ["native:button"],
  "packages/web-ui/src/components/copilot/AnnotationDomPinLayer.tsx": [
    "native:button",
  ],
  "packages/web-ui/src/components/copilot/CanvasAnnotationPinLayer.tsx": [
    "native:button",
  ],
  "packages/web-ui/src/components/copilot/VoiceInputSetupPopover.tsx": [
    "role:dialog",
  ],
};

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (!entry.isFile() || extname(entry.name) !== ".tsx") return [];
    if (/\.(?:test|spec|stories)\.tsx$/u.test(entry.name)) return [];
    return [path];
  });
}

function jsxAttributeLiteral(
  attributes: ts.JsxAttributes,
  name: string,
): string | null {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer))
    return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteral(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }
  return null;
}

function boundaryKinds(path: string): Set<BoundaryKind> {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const kinds = new Set<BoundaryKind>();

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      if (nativeControlNames.has(tagName)) kinds.add(`native:${tagName}`);
      const role = jsxAttributeLiteral(node.attributes, "role");
      if (role && complexRoles.has(role)) kinds.add(`role:${role}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return kinds;
}

describe("Web component primitive boundary ratchet", () => {
  it("keeps production UI behind shared interaction primitives", () => {
    const violations = sourceRoots
      .flatMap(productionTsxFiles)
      .flatMap((path) => {
        const repositoryPath = relative(repositoryRoot, path);
        const allowed = new Set(legacyAllowlist[repositoryPath] ?? []);
        return [...boundaryKinds(path)]
          .filter((kind) => !allowed.has(kind))
          .map((kind) => `${repositoryPath}: ${kind}`);
      });

    expect(violations).toEqual([]);
  });
});
