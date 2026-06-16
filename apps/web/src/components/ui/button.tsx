import { cva, type VariantProps } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium transition-all disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)]',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-primary)] text-white shadow-[var(--shadow-sm)] hover:bg-[var(--color-primary-hover)] hover:shadow-[var(--shadow-md)]',
        outline:
          'border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-primary)]',
        ghost:
          'text-[var(--color-text-soft)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]',
        soft: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)] hover:bg-[var(--color-sakura-soft)]',
        destructive:
          'bg-[var(--color-danger)] text-white shadow-[var(--shadow-sm)] hover:opacity-90',
      },
      size: {
        default: 'h-10 px-4 text-sm',
        sm: 'h-8 px-3 text-xs gap-1.5',
        lg: 'h-11 px-6 text-sm',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), loading && 'cursor-progress', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
