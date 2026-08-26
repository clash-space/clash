import * as React from "react";
import {
  CheckCircle,
  Info,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";

const feedbackTones = ["error", "warning", "info", "success"] as const;

type FeedbackTone = (typeof feedbackTones)[number];

const feedbackSurfaceVariants = cva(
  "text-[var(--feedback-ink)] border border-[var(--feedback-border)] bg-[var(--feedback-surface)]",
  {
    variants: {
      tone: {
        error:
          "[--feedback-border:var(--feedback-error-border)] [--feedback-ink:var(--feedback-error-ink)] [--feedback-surface:var(--feedback-error-surface)] bg-[var(--feedback-error-surface)]",
        warning:
          "[--feedback-border:var(--feedback-warning-border)] [--feedback-ink:var(--feedback-warning-ink)] [--feedback-surface:var(--feedback-warning-surface)] bg-[var(--feedback-warning-surface)]",
        info:
          "[--feedback-border:var(--feedback-info-border)] [--feedback-ink:var(--feedback-info-ink)] [--feedback-surface:var(--feedback-info-surface)] bg-[var(--feedback-info-surface)]",
        success:
          "[--feedback-border:var(--feedback-success-border)] [--feedback-ink:var(--feedback-success-ink)] [--feedback-surface:var(--feedback-success-surface)] bg-[var(--feedback-success-surface)]",
      },
      density: {
        inline: "rounded-[var(--feedback-inline-radius)] px-3 py-2 text-sm",
        panel: "rounded-[var(--feedback-panel-radius)] p-5",
        toast:
          "rounded-[var(--feedback-toast-radius)] px-3 py-2.5 shadow-[var(--feedback-toast-shadow)]",
      },
    },
    defaultVariants: {
      tone: "info",
      density: "inline",
    },
  },
);

const defaultIcons = {
  error: WarningCircle,
  warning: Warning,
  info: Info,
  success: CheckCircle,
} satisfies Record<FeedbackTone, React.ComponentType<{ className?: string; weight?: "fill" }>>;

type FeedbackSurfaceProps = React.ComponentProps<"div"> &
  VariantProps<typeof feedbackSurfaceVariants> & {
    tone?: FeedbackTone;
    density?: "inline" | "panel" | "toast";
  };

function FeedbackSurface({
  className,
  density = "inline",
  tone = "info",
  role,
  "aria-live": ariaLive,
  ...props
}: FeedbackSurfaceProps) {
  return (
    <div
      data-ui="feedback"
      data-slot="feedback-surface"
      data-tone={tone}
      data-density={density}
      role={role ?? (tone === "error" ? "alert" : "status")}
      aria-live={ariaLive ?? (tone === "error" ? "assertive" : "polite")}
      className={cn(feedbackSurfaceVariants({ tone, density }), className)}
      {...props}
    />
  );
}

interface InlineAlertProps extends Omit<FeedbackSurfaceProps, "children" | "title"> {
  title: React.ReactNode;
  message?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode | false;
}

function InlineAlert({
  action,
  className,
  icon,
  message,
  title,
  tone = "info",
  ...props
}: InlineAlertProps) {
  const Icon = defaultIcons[tone];

  return (
    <FeedbackSurface
      tone={tone}
      density="inline"
      className={cn("flex items-start gap-2.5", className)}
      {...props}
    >
      {icon === false ? null : (
        <span
          data-slot="feedback-icon"
          className="mt-0.5 shrink-0 text-current"
          aria-hidden="true"
        >
          {icon ?? <Icon className="h-4 w-4" weight="fill" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span data-slot="feedback-title" className="block font-semibold leading-5">
          {title}
        </span>
        {message ? (
          <span
            data-slot="feedback-message"
            className="mt-0.5 block text-sm leading-5 opacity-80"
          >
            {message}
          </span>
        ) : null}
      </span>
      {action ? (
        <span data-slot="feedback-action" className="shrink-0">
          {action}
        </span>
      ) : null}
    </FeedbackSurface>
  );
}

function ToastViewport({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-ui="toast-viewport"
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed bottom-[var(--space-overlay-edge)] right-[var(--space-overlay-edge)] z-[var(--z-toast)] flex w-[min(24rem,calc(100vw-2rem))] flex-col-reverse items-end gap-2",
        className,
      )}
      {...props}
    />
  );
}

export {
  FeedbackSurface,
  InlineAlert,
  ToastViewport,
  feedbackSurfaceVariants,
  feedbackTones,
};
export type { FeedbackSurfaceProps, FeedbackTone, InlineAlertProps };
