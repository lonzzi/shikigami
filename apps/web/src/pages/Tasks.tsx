import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Link as LinkIcon,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Input, SectionHeader } from '@/components/ui/primitives';
import { authHeaders, rpc } from '@/lib/api';
import { cn, formatBytes, formatDate } from '@/lib/utils';

type Task = {
  id: string;
  infoHash: string;
  rawTitle: string;
  status: string;
  progress: number;
  qbStateRaw: string | null;
  sizeBytes: string;
  fansub: string | null;
  subtitleLang: string | null;
  addedAt: string | null;
  dlspeed?: number;
  numSeeds?: number;
  numLeechs?: number;
  subscription?: { id: string; name: string } | null;
};

type Page = { items: Task[]; total: number; page: number; pageSize: number; hasMore: boolean };

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'DOWNLOADING', label: '下载中' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'ERROR', label: '错误' },
  { key: 'PAUSED', label: '已暂停' },
];

const PAGE_SIZE = 30;

export function TasksPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [magnet, setMagnet] = useState('');

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery<Page>({
      queryKey: ['tasks', filter, search],
      queryFn: async ({ pageParam }) => {
        const params = new URLSearchParams({
          page: String(pageParam),
          pageSize: String(PAGE_SIZE),
          ...(filter ? { status: filter } : {}),
          ...(search ? { search } : {}),
        });
        const res = await fetch(`/api/tasks?${params}`, { headers: authHeaders() });
        if (!res.ok) throw new Error('fetch failed');
        return res.json();
      },
      initialPageParam: 1,
      getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
      refetchInterval: 5000,
    });

  // 滚动加载: 触底自动 fetchNextPage
  const sentinel = useRef<HTMLDivElement | null>(null);
  const onObserve = useCallback(
    (node: HTMLDivElement | null) => {
      sentinel.current = node;
      if (!node || !hasNextPage || isFetchingNextPage) return;
      const ob = new IntersectionObserver(
        (entries) => entries[0]?.isIntersecting && fetchNextPage(),
        { rootMargin: '200px' },
      );
      ob.observe(node);
      return () => ob.disconnect();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  const tasks = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  const taskAction = async (
    task: Task,
    action: 'pause' | 'resume' | 'retry' | 'redownload' | 'import',
    label: string,
  ) => {
    const tid = toast.loading(`${label}…`);
    try {
      // qB 直接管(用 infoHash), DB 没记录的也能操作
      const headers = { ...authHeaders(), 'content-type': 'application/json' as const };
      if (task.id === task.infoHash) {
        // qB 直接种子(无 DB 记录): 直接调 qB API
        const map: Record<string, string> = {
          pause: 'pause',
          resume: 'start',
          retry: 'start',
          redownload: 'start',
          import: 'import',
        };
        void map;
        // 这些操作对无 DB 记录的种子意义有限, 走 qB 直调
        const qbActions: Record<string, string> = { pause: 'pause', resume: 'start' };
        if (qbActions[action]) {
          await fetch(`/api/qb/torrents`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ action: qbActions[action], hash: task.infoHash }),
          }).catch(() => {});
        }
      } else {
        const routes = rpc.api.tasks[':id'];
        const map = {
          pause: routes.pause.$post,
          resume: routes.resume.$post,
          retry: routes.retry.$post,
          redownload: routes.redownload.$post,
          import: routes.import.$post,
        } as const;
        await map[action]({ param: { id: task.id } });
      }
      toast.success(`${label}成功`, { id: tid });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch {
      toast.error(`${label}失败`, { id: tid });
    }
  };

  const delM = useMutation({
    mutationFn: async (task: Task) => {
      if (task.id === task.infoHash) {
        // qB 直接删
        await fetch(`/api/tasks/${task.infoHash}`, {
          method: 'DELETE',
          headers: authHeaders(),
        }).catch(() => {});
      } else {
        await rpc.api.tasks[':id'].$delete({ param: { id: task.id } });
      }
    },
    onSuccess: () => {
      toast.success('已删除');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: () => toast.error('删除失败'),
  });

  const addM = useMutation({
    mutationFn: async () => (await rpc.api.tasks.$post({ json: { magnet } })).json(),
    onSuccess: () => {
      toast.success('已添加');
      setMagnet('');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: () => toast.error('添加失败'),
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        title="下载任务"
        desc={`qBittorrent · 共 ${total} 个`}
        action={
          <div className="flex gap-2">
            <Input
              className="w-64"
              value={magnet}
              onChange={(e) => setMagnet(e.target.value)}
              placeholder="粘贴磁力链接添加"
            />
            <Button loading={addM.isPending} onClick={() => addM.mutate()} disabled={!magnet}>
              添加
            </Button>
          </div>
        }
      />

      {/* 过滤 + 搜索 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                filter === f.key
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-soft)] hover:bg-[var(--color-surface-2)]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-faint)]" />
          <Input
            className="w-56 pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题 / 字幕组 / 订阅"
          />
        </div>
      </div>

      {/* 列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-muted)]">
          <Loader2 className="spin size-4" /> 加载中…
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={Download}
            title="没有下载任务"
            desc={filter || search ? '没有匹配的任务' : '粘贴磁力链接,或创建订阅后自动下载'}
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onAction={taskAction} onDelete={() => delM.mutate(t)} />
          ))}

          {/* 滚动加载哨兵 */}
          <div ref={onObserve} className="flex justify-center py-4">
            {isFetchingNextPage ? (
              <span className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                <Loader2 className="spin size-4" /> 加载更多…
              </span>
            ) : hasNextPage ? (
              <span className="text-xs text-[var(--color-faint)]">滚动加载更多</span>
            ) : (
              tasks.length > 0 && (
                <span className="text-xs text-[var(--color-faint)]">
                  已全部加载 · 共 {total} 个
                </span>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onAction,
  onDelete,
}: {
  task: Task;
  onAction: (t: Task, a: 'pause' | 'resume' | 'retry' | 'redownload' | 'import', l: string) => void;
  onDelete: () => void;
}) {
  const isDl = task.status === 'DOWNLOADING';
  return (
    <Card className="space-y-3 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[var(--color-text)]">{task.rawTitle}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
            <Badge tone={downloadTone(task.status)}>{downloadLabel(task.status)}</Badge>
            {task.subscription && <Badge tone="primary">订阅: {task.subscription.name}</Badge>}
            {task.fansub && <span>{task.fansub}</span>}
            {task.subtitleLang && <Badge tone="neutral">{task.subtitleLang}</Badge>}
            {isDl && task.numSeeds !== undefined && (
              <span className="text-[var(--color-faint)]">
                {task.numSeeds} seeds ·{' '}
                {(task.dlspeed ?? 0) / 1024 / 1024 >= 1
                  ? `${(task.dlspeed! / 1024 / 1024).toFixed(1)} MB/s`
                  : `${Math.round((task.dlspeed ?? 0) / 1024)} KB/s`}
              </span>
            )}
            <span>{formatBytes(task.sizeBytes)}</span>
            {task.addedAt && <span>· {formatDate(task.addedAt)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {isDl && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="暂停"
              onClick={() => onAction(task, 'pause', '暂停')}
            >
              <Pause className="size-4" />
            </Button>
          )}
          {task.status === 'PAUSED' && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="恢复"
              onClick={() => onAction(task, 'resume', '恢复')}
            >
              <Play className="size-4" />
            </Button>
          )}
          {task.status === 'COMPLETED' && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="导入媒体库"
              onClick={() => onAction(task, 'import', '导入')}
            >
              <LinkIcon className="size-4" />
            </Button>
          )}
          {task.status === 'ERROR' && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="重试"
              onClick={() => onAction(task, 'retry', '重试')}
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" title="删除" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {isDl && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-500"
              style={{ width: `${Math.round(task.progress * 100)}%` }}
            />
          </div>
          <span className="w-10 text-right text-xs font-medium text-[var(--color-muted)]">
            {Math.round(task.progress * 100)}%
          </span>
        </div>
      )}
    </Card>
  );
}

function downloadTone(s: string): 'success' | 'danger' | 'info' | 'warning' | 'neutral' {
  if (['COMPLETED'].includes(s)) return 'success';
  if (['ERROR', 'ABANDONED'].includes(s)) return 'danger';
  if (['DOWNLOADING'].includes(s)) return 'info';
  if (['PAUSED'].includes(s)) return 'warning';
  return 'neutral';
}
function downloadLabel(s: string): string {
  return (
    {
      DOWNLOADING: '下载中',
      COMPLETED: '已完成',
      ERROR: '错误',
      PAUSED: '已暂停',
      ABANDONED: '已放弃',
      RENAMED: '已重命名',
      PENDING: '等待中',
      RETRY: '重试中',
    }[s] ?? s
  );
}
