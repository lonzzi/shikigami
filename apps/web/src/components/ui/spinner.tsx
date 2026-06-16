import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 加载指示器。默认用 lucide 旋转图标。 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('spin', className)} />;
}
