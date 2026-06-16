import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind class merge helper (shadcn 约定)。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 格式化字节 → 人类可读。 */
export function formatBytes(bytes: string | number | bigint | null | undefined): string {
  if (bytes == null) return '-';
  const n = typeof bytes === 'bigint' ? Number(bytes) : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 格式化日期。 */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '-';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** 状态 → 颜色 class（亮色主题适配,用 -600/-700 深色保证对比度）。 */
export function statusColor(status: string): string {
  const map: Record<string, string> = {
    COMPLETED: 'text-emerald-600',
    DOWNLOADING: 'text-blue-600',
    RENAMED: 'text-emerald-600',
    EXPORTED: 'text-emerald-600',
    ERROR: 'text-red-600',
    FAILED: 'text-red-600',
    ABANDONED: 'text-red-600',
    PAUSED: 'text-amber-600',
    PENDING: 'text-[var(--color-muted)]',
    MATCHED: 'text-amber-600',
    REVIEWED: 'text-amber-600',
    success: 'text-emerald-600',
    failed: 'text-red-600',
    running: 'text-blue-600',
    queued: 'text-[var(--color-muted)]',
  };
  return map[status] ?? 'text-[var(--color-muted)]';
}
