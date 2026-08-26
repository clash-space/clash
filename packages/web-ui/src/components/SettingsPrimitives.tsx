import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "./ai-elements/utils";

export function SettingsSectionLayout({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-slot="settings-section"
      data-density="compact"
      className={cn(
        "mx-auto w-full max-w-3xl space-y-[var(--settings-section-gap)] pb-8",
        className,
      )}
      {...props}
    />
  );
}

export function SettingsSectionHeader({
  action,
  className,
  description,
  icon,
  title,
  titleId,
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  titleId?: string;
}) {
  return (
    <header
      data-slot="settings-section-header"
      className={cn("flex min-w-0 items-start gap-2.5", className)}
    >
      {icon ? (
        <span
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2
          id={titleId}
          className="font-display text-base font-semibold leading-5 text-foreground"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[length:var(--settings-type-size)] leading-[var(--settings-type-line)] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SettingsPanel({
  as: Component = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
}) {
  return (
    <Component
      data-slot="settings-panel"
      className={cn(
        "rounded-[var(--settings-row-radius)] border border-border bg-card text-card-foreground shadow-none",
        className,
      )}
      {...props}
    />
  );
}

export function SettingsCollection({
  as: Component = "div",
  className,
  layout = "stack",
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  layout?: "stack" | "grid";
}) {
  return (
    <Component
      data-slot="settings-collection"
      className={cn(
        "grid gap-[var(--settings-row-gap)]",
        layout === "grid" && "sm:grid-cols-2",
        className,
      )}
      {...props}
    />
  );
}

export const settingsRowClassName =
  "min-h-[var(--settings-row-height)] overflow-hidden rounded-[var(--settings-row-radius)] border border-border bg-card text-card-foreground shadow-none";

export function SettingsRow({
  as: Component = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
}) {
  return (
    <Component
      data-slot="settings-row"
      className={cn(
        settingsRowClassName,
        className,
      )}
      {...props}
    />
  );
}

export function SettingsActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="settings-actions"
      className={cn(
        "flex flex-wrap items-center justify-end gap-1.5",
        className,
      )}
      {...props}
    />
  );
}

export function SettingsFieldGroup({
  children,
  className,
  description,
  label,
}: {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  label: ReactNode;
}) {
  return (
    <div
      data-slot="settings-field-group"
      className={cn("space-y-1.5", className)}
    >
      <div>
        <div className="text-[length:var(--settings-type-size)] font-medium leading-[var(--settings-type-line)] text-foreground">
          {label}
        </div>
        {description ? (
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingsEmptyState({
  as: Component = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
}) {
  return (
    <Component
      data-slot="settings-empty-state"
      className={cn(
        "px-2 py-1.5 text-[length:var(--settings-type-size)] leading-[var(--settings-type-line)] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
