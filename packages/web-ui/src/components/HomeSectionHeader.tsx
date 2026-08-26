import type { ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { Link, type LinkProps } from "react-router";

import { cn } from "./ai-elements/utils";
import { buttonVariants } from "./ui/button";

export function HomeSectionActionLink({
  children,
  className,
  ...props
}: LinkProps) {
  return (
    <Link
      data-slot="home-section-action-link"
      className={cn(
        buttonVariants({ size: "sm" }),
        "h-7 gap-1 rounded-md border-transparent bg-transparent px-2 text-xs text-content-secondary shadow-none hover:bg-warm-hover hover:text-content-primary focus-visible:ring-offset-warm-page",
        className,
      )}
      {...props}
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" weight="regular" aria-hidden="true" />
    </Link>
  );
}

export function HomeSectionHeader({
  id,
  title,
  action,
  alignWithChrome = false,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  alignWithChrome?: boolean;
}) {
  return (
    <div
      data-slot="home-section-header"
      data-align={alignWithChrome ? "app-chrome" : undefined}
      className="clash-home-section-header sticky top-0 z-[2] bg-warm-page"
    >
      <h2 id={id} className="clash-home-section-title">
        {title}
      </h2>
      {action ? (
        <div className="clash-home-section-action">{action}</div>
      ) : null}
    </div>
  );
}
