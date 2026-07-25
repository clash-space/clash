export type DirectorTransformMode = "translate" | "rotate" | "scale";
export type DirectorViewPreset = "top" | "front" | "reset";

export type DirectorShortcutAction =
  | { type: "mode"; mode: DirectorTransformMode }
  | { type: "toggle-snap" }
  | { type: "view"; view: DirectorViewPreset }
  | { type: "delete" }
  | { type: "group" }
  | { type: "ungroup" }
  | { type: "undo" };

export function directorShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): DirectorShortcutAction | null {
  const key = event.key.toLowerCase();
  const command = Boolean(event.ctrlKey || event.metaKey);
  if (command && key === "g") {
    return event.shiftKey ? { type: "ungroup" } : { type: "group" };
  }
  if (command && key === "z") return { type: "undo" };
  if (event.key === "Delete" || event.key === "Backspace") return { type: "delete" };
  if (key === "v") return { type: "mode", mode: "translate" };
  if (key === "r") return { type: "mode", mode: "rotate" };
  if (key === "s") return { type: "mode", mode: "scale" };
  if (key === "x") return { type: "toggle-snap" };
  if (key === "t") return { type: "view", view: "top" };
  if (key === "y") return { type: "view", view: "front" };
  if (key === "q") return { type: "view", view: "reset" };
  return null;
}
