import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

export function Card({
  className,
  hover,
  ...props
}: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div className={cn('card p-5', hover && 'card-hover cursor-pointer', className)} {...props} />
  );
}

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const tones: Record<string, string> = {
    neutral:
      'bg-[var(--color-surface-2)] text-[var(--color-text-soft)] border-[var(--color-border)]',
    primary: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)] border-transparent',
    success: 'bg-[var(--color-success-soft)] text-[var(--color-success)] border-transparent',
    warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-transparent',
    danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-transparent',
    info: 'bg-[var(--color-info-soft)] text-[var(--color-info)] border-transparent',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tnum',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)] transition-colors',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Label = ({ className, ...props }: HTMLAttributes<HTMLLabelElement>) => (
  <label
    className={cn('mb-1.5 block text-xs font-medium text-[var(--color-text-soft)]', className)}
    {...props}
  />
);

/** 区块标题 + 可选操作区（标题用明朝 display）*/
export function SectionHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[1.6rem] font-semibold tracking-tight text-[var(--color-ink)]">
          {title}
        </h1>
        {desc && <p className="mt-1 text-sm text-[var(--color-muted)]">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

/** 空状态: 大图标 + 标题 + 描述 + 可选 CTA */
export function EmptyState({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] text-[var(--color-faint)]">
        <Icon className="size-8" />
      </div>
      <p className="mt-4 font-medium text-[var(--color-text-soft)]">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-sm text-[var(--color-muted)]">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 加载占位 */
export function LoadingState({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-muted)]">
      <Spinner /> {text}
    </div>
  );
}
