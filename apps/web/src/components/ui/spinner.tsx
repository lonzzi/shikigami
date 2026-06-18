import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 加载指示器（朱色）。默认 size-4，可被 className 覆盖。 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('spin size-4 text-[var(--color-primary)]', className)} />;
}
