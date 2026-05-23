"use client";

// Faithful port of the bare Message / MessageContent pair from
// vercel/ai-elements packages/elements/src/message.tsx. Skipping the
// MessageActions / MessageAvatar / MessageReasoning / version-cycling
// sub-components because the chat panel doesn't need them yet — we
// can add them later from the same upstream file if needed. Imports
// rewritten away from `@repo/shadcn-ui` to our local utils.

import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
