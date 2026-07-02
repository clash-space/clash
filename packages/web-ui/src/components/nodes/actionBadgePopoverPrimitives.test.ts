import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

describe("ActionBadge popover primitives", () => {
    it("uses shared popover primitives for picker menus instead of hand-rolled document listeners", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("../ui/popover");
        expect(source).toContain("PopoverContent");
        expect(source).toContain("open={showPanel}");
        expect(source).toContain("PopoverTrigger asChild");
        expect(source).not.toContain('role="button"');
        expect(source).not.toContain("event.key === 'Enter' || event.key === ' '");
        expect(source).not.toContain("createPortal");
        expect(source).not.toContain("document.addEventListener('mousedown'");
        expect(source).not.toContain("document.removeEventListener('mousedown'");
        expect(source).not.toContain("document.addEventListener('pointerdown'");
        expect(source).not.toContain("document.addEventListener('keydown', onEsc");
    });

    it("computes reference picker candidates for both legacy and slot-target pickers", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("showRefPicker || refPickerTarget !== null");
    });

    it("uses the shared node modal shell for the expanded prompt editor", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("./NodeModalDialog");
        expect(source).not.toContain("fixed inset-0 z-[9999] flex items-center justify-center p-8");
    });

    it("uses Ariakit combobox primitives for the inline asset mention picker", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("@ariakit/react");
        expect(source).toContain("ComboboxProvider");
        expect(source).toContain("ComboboxList");
        expect(source).toContain("ComboboxItem");
        expect(source).not.toContain("onKeyDown={isFrozen ? undefined : (e) =>");
        expect(source).not.toContain("mentionIndex");
        expect(source).not.toContain("setMentionIndex");
        expect(source).not.toContain("activeIndex");
        expect(source).not.toContain("onMouseEnter={() => onHover(idx)}");
        expect(source).not.toContain("selectValueOnClick={false}");
        expect(source).not.toContain("onClick={() => {\n                                onPick(node);");
        expect(source).not.toContain("@ mention dropdown with thumbnails");
        expect(source).not.toContain("absolute left-4 right-4 bottom-full mb-1 bg-warm-surface border border-warm-border rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto");
    });

    it("uses the shared select primitive for the batch count picker", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("BATCH_COUNT_OPTIONS");
        expect(source).toContain('ariaLabel="Batch count"');
        expect(source).not.toContain("countPopoverOpen");
        expect(source).not.toContain("[1, 2, 3, 4].map");
    });

    it("uses shared select primitives for expanded select and boolean parameter choices", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("PARAM_BOOLEAN_OPTIONS");
        expect(source).toContain("paramOptionsToSelectOptions");
        expect(source).not.toContain("p.options?.map((opt)");
        expect(source).not.toContain("[{ l: 'On', v: true }, { l: 'Off', v: false }].map");
    });

    it("uses the shared collapsible primitive for expanded parameter rows", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("../ui/collapsible");
        expect(source).toContain("Collapsible");
        expect(source).toContain("CollapsibleTrigger asChild");
        expect(source).toContain("CollapsibleContent");
        expect(source).not.toContain("setExpandedParam(isExpanded ? null : p.id)");
        expect(source).not.toContain("{isExpanded && (");
    });

    it("uses shared tooltip primitives for action control buttons instead of browser title attributes", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("../ui/tooltip");
        expect(source).toContain("<Tooltip label={modelPickerLabel}>");
        expect(source).toContain('<Tooltip label="Duplicate this panel and open the copy">');
        expect(source).toContain("<Tooltip label={frozenRunLabel}>");
        expect(source).toContain("<Tooltip label={panelRunLabel}>");
        expect(source).not.toContain("title={customActionOffline ? RUNTIME_OFFLINE_TOOLTIP : undefined}");
        expect(source).not.toContain('title="Duplicate this panel and open the copy"');
        expect(source).not.toContain("title={customActionOffline ? RUNTIME_OFFLINE_TOOLTIP : 'Run again with current parameters'}");
        expect(source).not.toContain("TooltipProvider");
        expect(source).not.toContain("TooltipAnchor");
    });

    it("uses shared tooltip primitives for reference picker labels and keeps mention HTML title-free", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("<Tooltip key={n.id} label={label}>");
        expect(source).not.toContain('title="${label}"');
        expect(source).not.toContain("title={label}");
    });

    it("uses ReactFlow interaction boundary classes for node form controls instead of mouse suppression", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("NODE_INTERACTION_BOUNDARY_CLASS");
        expect(source).toContain("nodrag nopan");
        expect(source).not.toContain("onMouseDown={(e) => e.stopPropagation()}");
        expect(source).not.toContain("onPointerDown={e => e.stopPropagation()}");
    });

    it("uses shared button primitives for action badge controls", () => {
        const source = readNodeSource("ActionBadge.tsx");

        expect(source).toContain("../ui/button");
        expect(source).toContain("../ui/icon-button");
        expect(source).toContain("<Button");
        expect(source).toContain("<IconButton");
        expect(source).not.toContain("<button");
        expect(source).not.toContain("<motion.button");
    });
});
