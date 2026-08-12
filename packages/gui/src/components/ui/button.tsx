import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-warm-border bg-warm-surface text-stone-800 shadow-sm hover:bg-warm-hover dark:text-stone-100 focus-visible:ring-brand focus-visible:ring-offset-warm-surface',
        primary:
          'bg-brand text-brand-foreground shadow-md hover:bg-brand/90 focus-visible:ring-brand focus-visible:ring-offset-warm-surface',
        destructive:
          'border border-red-500/25 bg-red-500/5 text-red-700 shadow-sm hover:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15 focus-visible:ring-red-500 focus-visible:ring-offset-warm-surface',
      },
      size: {
        sm: 'min-h-9 px-3 py-1.5 text-xs',
        md: 'min-h-11 px-4 py-2 text-sm',
        lg: 'min-h-12 px-5 py-3 text-base',
      },
      shape: {
        rounded: 'rounded-xl',
        pill: 'rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      shape: 'rounded',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, className, leftIcon, rightIcon, shape, size, type = 'button', variant, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ shape, size, variant }), className)}
        {...props}
      >
        {leftIcon ? (
          <span aria-hidden="true" className="flex shrink-0">
            {leftIcon}
          </span>
        ) : null}
        {children}
        {rightIcon ? (
          <span aria-hidden="true" className="flex shrink-0">
            {rightIcon}
          </span>
        ) : null}
      </button>
    );
  },
);
Button.displayName = 'Button';
