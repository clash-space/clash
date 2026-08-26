import { CaretRight } from "@phosphor-icons/react";
import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "./ai-elements/utils";

export type AppPageWidth = "narrow" | "standard" | "wide";

const widthClass: Record<AppPageWidth, string> = {
  narrow: "max-w-[var(--app-page-content-narrow)]",
  standard: "max-w-[var(--app-page-content-standard)]",
  wide: "max-w-[var(--app-page-content-wide)]",
};

type AppPageInsetProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  width?: AppPageWidth;
};

export function AppPageInset({
  as: Component = "div",
  className,
  width = "standard",
  ...props
}: AppPageInsetProps) {
  return (
    <Component
      data-slot="app-page-inset"
      data-width={width}
      className={cn(
        "mx-auto w-full px-[var(--app-page-inline-inset)]",
        widthClass[width],
        className,
      )}
      {...props}
    />
  );
}

export function AppPage({
  as: Component = "div",
  className,
  width = "standard",
  ...props
}: AppPageInsetProps) {
  return (
    <Component
      data-slot="app-page"
      data-width={width}
      className={cn(
        "mx-auto w-full px-[var(--app-page-inline-inset)] pb-[var(--app-page-block-end)] pt-[var(--app-page-block-start)]",
        widthClass[width],
        className,
      )}
      {...props}
    />
  );
}

export function AppBreadcrumb({
  className,
  items,
}: {
  className?: string;
  items: Array<{ label: string; to?: string }>;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      data-slot="app-breadcrumb"
      className={cn("mb-6", className)}
    >
      <ol className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li
              key={`${item.label}-${index}`}
              className="flex min-w-0 items-center gap-2"
            >
              {index > 0 ? (
                <CaretRight
                  className="size-3.5 shrink-0 text-content-muted"
                  weight="bold"
                  aria-hidden="true"
                />
              ) : null}
              {item.to && !current ? (
                <Link
                  to={item.to}
                  className="truncate rounded-sm text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={current ? "page" : undefined}
                  className="truncate font-medium text-content-primary"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AppPageHeaderBand({
  children,
  className,
  width = "standard",
}: {
  children: ReactNode;
  className?: string;
  width?: AppPageWidth;
}) {
  return (
    <div
      data-slot="app-page-header-band"
      className={cn(
        "sticky top-[var(--app-page-sticky-header-top)] z-30 bg-background",
        className,
      )}
    >
      <AppPageInset
        width={width}
        className="flex h-[var(--app-page-header-band-height)] items-center"
      >
        {children}
      </AppPageInset>
    </div>
  );
}

export function AppPageHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  title: ReactNode;
}) {
  return (
    <header
      data-slot="app-page-header"
      className="mb-[var(--app-page-header-gap)] flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold tracking-tight text-content-primary">
          {title}
        </h1>
        <p className="mt-2 max-w-[65ch] text-base leading-6 text-content-secondary">
          {description}
        </p>
      </div>
      {action ? (
        <div data-slot="app-page-header-action" className="shrink-0">
          {action}
        </div>
      ) : null}
    </header>
  );
}
