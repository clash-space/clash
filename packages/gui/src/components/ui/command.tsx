import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, MagnifyingGlass } from "@phosphor-icons/react";

import { cn } from "../../lib/cn";

export const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      data-slot="command"
      className={cn(
        "flex size-full min-h-0 flex-col overflow-hidden rounded-lg p-1",
        className,
      )}
      {...props}
    />
  );
});

export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(function CommandInput({ className, ...props }, ref) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <div className="app-command-input-surface flex h-8 items-center gap-2 rounded-lg border border-input bg-input/30 px-2.5 shadow-none">
        <MagnifyingGlass
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <CommandPrimitive.Input
          ref={ref}
          data-slot="command-input"
          className={cn(
            "w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
      </div>
    </div>
  );
});

export const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      data-slot="command-list"
      className={cn(
        "max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none",
        className,
      )}
      {...props}
    />
  );
});

export const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(function CommandEmpty({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Empty
      ref={ref}
      data-slot="command-empty"
      className={cn(
        "py-6 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
});

export const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref}
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
});

export const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(function CommandSeparator({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Separator
      ref={ref}
      data-slot="command-separator"
      className={cn("app-select-separator -mx-1 h-px", className)}
      {...props}
    />
  );
});

export const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(function CommandItem({ className, ...props }, ref) {
  const { children, ...itemProps } = props;
  return (
    <CommandPrimitive.Item
      ref={ref}
      data-slot="command-item"
      className={cn(
        "app-select-item app-select-focus group/command-item relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...itemProps}
    >
      {children}
      <Check
        className="app-select-selected ml-auto size-4 opacity-0 group-data-[checked=true]/command-item:opacity-100"
        aria-hidden="true"
      />
    </CommandPrimitive.Item>
  );
});
