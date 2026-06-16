import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as LinkIcon, ListChecks, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Input, Label, SectionHeader } from '@/components/ui/primitives';
import { rpc } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type Sub = {
  id: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  category: string;
  filterRule: string;
  lastRunAt: string | null;
  lastMatchCount: number;
  series?: { titleCn: string | null; titleJp: string } | null;
  _count?: { downloadTasks: number };
};

export function SubscriptionsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery<Sub[]>({
    queryKey: ['subscriptions', search],
    queryFn: async () => {
      const res = await rpc.api.subscriptions.$get({ query: search ? { search } : undefined });
      return res.json();
    },
  });
  const [showForm, setShowForm] = useState(false);

  const runMutation = useMutation({
    mutationFn: async (id: string) => {
      const tid = toast.loading('正在抓取 RSS…');
      try {
        const d: any = await (
          await rpc.api.subscriptions[':id'].run.$post({ param: { id } })
        ).json();
        toast.success(`本次匹配 ${d.matched} 项`, { id: tid });
      } catch {
        toast.error('执行失败', { id: tid });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      (await rpc.api.subscriptions[':id'].$delete({ param: { id } })).json(),
    onSuccess: () => {
      toast.success('订阅已删除');
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
    onError: () => toast.error('删除失败'),
  });

  const preview = async (id: string) => {
    const tid = toast.loading('预览匹配中…');
    try {
      const res = await rpc.api.subscriptions[':id'].preview.$get({ param: { id } });
      const d: any = await res.json();
      if ('total' in d) toast.info(`总计 ${d.total} 条 · 匹配 ${d.matched.length} 条`, { id: tid });
      else toast.error('预览失败', { id: tid });
    } catch {
      toast.error('预览失败', { id: tid });
    }
  };

  const rebindMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await rpc.api.subscriptions[':id'].rebind.$post({ param: { id } });
      return res.json();
    },
    onSuccess: (d: any) => {
      if (d.ok) toast.success(`已关联: ${d.series?.titleCn ?? d.series?.titleJp}`);
      else toast.error(d.error === 'series_not_found' ? '未找到匹配的番剧' : '关联失败');
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
    onError: () => toast.error('关联失败'),
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="订阅"
        desc="配置 RSS 抓取规则，自动下载匹配的番剧"
        action={
          <div className="flex gap-2">
            <Input
              className="w-48"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索订阅 / 番剧"
            />
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus className="size-4" /> 新建订阅
            </Button>
          </div>
        }
      />

      {showForm && <SubscriptionForm onDone={() => setShowForm(false)} />}

      {isLoading ? (
        <Card>
          <div className="py-8 text-center text-sm text-[var(--color-muted)]">加载中…</div>
        </Card>
      ) : data && data.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="还没有订阅"
            desc="创建一个订阅，配置站点和关键词，系统会自动抓取并下载匹配的番剧"
            action={
              <Button onClick={() => setShowForm(true)}>
                <Plus className="size-4" /> 新建订阅
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data?.map((s) => (
            <Card key={s.id} hover className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--color-text)]">{s.name}</span>
                  <Badge tone={s.enabled ? 'success' : 'neutral'}>
                    {s.enabled ? '启用' : '停用'}
                  </Badge>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-sm">
                  {s.series ? (
                    <Badge tone="primary">{s.series.titleCn ?? s.series.titleJp}</Badge>
                  ) : (
                    <button
                      type="button"
                      onClick={() => rebindMutation.mutate(s.id)}
                      className="text-[var(--color-warning)] underline-offset-2 hover:underline"
                    >
                      未关联番剧 · 点击自动关联
                    </button>
                  )}
                  <span className="text-[var(--color-muted)]">· {s.category}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-faint)]">
                  {s._count?.downloadTasks ?? 0} 个任务 · 上次运行 {formatDate(s.lastRunAt)} · 匹配{' '}
                  {s.lastMatchCount}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" title="预览" onClick={() => preview(s.id)}>
                  <Play className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="立即运行"
                  onClick={() => runMutation.mutate(s.id)}
                >
                  <ListChecks className="size-4" />
                </Button>
                {!s.series && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="关联番剧"
                    onClick={() => rebindMutation.mutate(s.id)}
                  >
                    <LinkIcon className="size-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="删除"
                  onClick={() => deleteMutation.mutate(s.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SubscriptionForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sources, setSources] = useState<string[]>(['dmhy']);
  const [fansubs, setFansubs] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const filterRule: any = { sources, keyword: keyword || undefined };
      if (fansubs)
        filterRule.fansubs = fansubs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      return (
        await rpc.api.subscriptions.$post({ json: { name, filterRule, category: '动漫' } as any })
      ).json();
    },
    onSuccess: () => {
      toast.success('订阅已创建');
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onDone();
    },
    onError: () => toast.error('创建失败'),
  });

  return (
    <Card className="space-y-4">
      <h2 className="font-medium text-[var(--color-text)]">新建订阅</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>名称</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：葬送的芙莉莲"
          />
        </div>
        <div>
          <Label>关键词</Label>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="标题关键词"
          />
        </div>
      </div>
      <div>
        <Label>站点</Label>
        <div className="flex flex-wrap gap-2">
          {(['dmhy', 'mikan', 'nyaa', 'bangumimoe'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() =>
                setSources((prev) =>
                  prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                )
              }
              className={`rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors ${
                sources.includes(s)
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border-strong)] text-[var(--color-text-soft)] hover:bg-[var(--color-surface-2)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>字幕组（逗号分隔，可选）</Label>
        <Input
          value={fansubs}
          onChange={(e) => setFansubs(e.target.value)}
          placeholder="ANi, ANON"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          loading={create.isPending}
          onClick={() => create.mutate()}
          disabled={!name || !keyword}
        >
          创建订阅
        </Button>
        <Button variant="ghost" onClick={onDone}>
          取消
        </Button>
      </div>
    </Card>
  );
}
