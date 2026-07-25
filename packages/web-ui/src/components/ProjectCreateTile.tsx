import { type FormEvent, useId, useRef, useState } from "react";
import { Plus } from "@phosphor-icons/react";

import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

interface ProjectCreateTileProps {
  ariaLabel: string;
  empty?: boolean;
  onCreate: (projectName: string) => void | Promise<void>;
}

export default function ProjectCreateTile({
  ariaLabel,
  empty = false,
  onCreate,
}: ProjectCreateTileProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (pending) return;
    setOpen(false);
    setName("");
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const projectName = name.trim();

    if (!projectName) {
      inputRef.current?.focus();
      return;
    }

    setPending(true);
    setError(null);

    try {
      await onCreate(projectName);
      setOpen(false);
      setName("");
      setPending(false);
    } catch {
      setError("Could not create this project. Try again.");
      setPending(false);
    }
  };

  return (
    <>
      <Button
        aria-label={ariaLabel}
        className={`${empty ? "clash-project-create-tile--empty " : ""}clash-project-create-tile group flex aspect-video min-h-0 flex-col items-center justify-center gap-4 rounded-none p-0 focus-visible:ring-offset-warm-page`}
        onClick={() => setOpen(true)}
      >
        <Plus
          className="h-10 w-10 text-stone-600 transition-colors group-hover:text-brand dark:text-stone-300"
          weight="bold"
          aria-hidden="true"
        />
        <span className="text-base font-semibold text-stone-700 transition-colors group-hover:text-slate-950 dark:text-stone-300 dark:group-hover:text-slate-50">
          New Project
        </span>
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        title="Create project"
        description="Choose a name for the new project."
        size="sm"
        disableBackdropClose={pending}
      >
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-stone-700 dark:text-stone-300"
          >
            Project name
          </label>
          <Input
            ref={inputRef}
            id={inputId}
            autoFocus
            maxLength={120}
            value={name}
            aria-invalid={Boolean(error)}
            className="mt-2 w-full rounded-xl border border-warm-border bg-warm-page px-4 py-3 text-base font-medium text-slate-950 shadow-sm dark:text-slate-50"
            onChange={(event) => setName(event.target.value)}
            placeholder="Untitled project"
          />
          {error ? (
            <p className="mt-2 text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button disabled={pending} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="rounded-md px-4 shadow-none"
              disabled={!name.trim() || pending}
            >
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
