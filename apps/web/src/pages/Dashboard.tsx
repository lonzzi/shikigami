import { useQuery } from '@tanstack/react-query';
import { Activity, Database, HardDrive, Magnet, Sparkles, TrendingUp } from 'lucide-react';
import { Badge, Card, LoadingState } from '@/components/ui/primitives';
import { rpc } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

type Metrics = {
  queue: { import: number; scrape: number };
  pendingScrape: number;
  completedMedia: number;
  downloadsByStatus: Record<string, number>;
  jobs: { successRatio: number; byStatus: Record<string, number> };
  qbittorrent: {
    connected: boolean;
    appVersion: string | null;
    torrentsCount: number | null;
    freeSpaceBytes: string | null;
  };
  disk: { freeBytes: string | null };
};

export function DashboardPage() {
  const { data: m, isLoading } = useQuery<Metrics>({
    queryKey: ['metrics'],
    queryFn: async () => {
      const res = await rpc.api.metrics.$get();
      if (!res.ok) throw new Error('metrics failed');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  if (isLoading || !m) return <LoadingState />;

  const queueTotal = (m.queue.import ?? 0) + (m.queue.scrape ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">系统运行概览</p>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Activity}
          label="队列任务"
          value={queueTotal}
          sub={`导入 ${m.queue.import} · 刮削 ${m.queue.scrape}`}
          tone="info"
        />
        <StatCard
          icon={Sparkles}
          label="待刮削"
          value={m.pendingScrape}
          sub="等待 AI 识别"
          tone={m.pendingScrape > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          icon={Database}
          label="已入库"
          value={m.completedMedia}
          sub="媒体文件"
          tone="success"
        />
        <StatCard
          icon={Magnet}
          label="qB 种子"
          value={m.qbittorrent.torrentsCount ?? 0}
          sub={m.qbittorrent.connected ? 'qBittorrent 在线' : 'qBittorrent 离线'}
          tone={m.qbittorrent.connected ? 'info' : 'danger'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* qBittorrent */}
        <Card>
          <SectionTitle
            icon={Activity}
            title="qBittorrent"
            badge={
              m.qbittorrent.connected
                ? { text: '在线', tone: 'success' }
                : { text: '离线', tone: 'danger' }
            }
          />
          <dl className="space-y-3">
            <Row label="版本" value={m.qbittorrent.appVersion ?? '-'} />
            <Row label="种子数" value={m.qbittorrent.torrentsCount ?? '-'} />
          </dl>
        </Card>

        {/* 任务成功率 */}
        <Card>
          <SectionTitle
            icon={TrendingUp}
            title="任务执行"
            badge={{ text: `${Math.round(m.jobs.successRatio * 100)}% 成功`, tone: 'info' }}
          />
          {Object.keys(m.jobs.byStatus).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(m.jobs.byStatus).map(([k, v]) => (
                <Badge key={k} tone={jobTone(k)}>
                  {jobLabel(k)} · {v}
                </Badge>
              ))}
            </div>
          ) : (
            <EmptyLine text="暂无任务记录" />
          )}
        </Card>

        {/* 下载任务状态分布 */}
        <Card>
          <SectionTitle icon={Activity} title="下载任务状态" />
          {Object.keys(m.downloadsByStatus).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(m.downloadsByStatus).map(([k, v]) => (
                <Badge key={k} tone={downloadTone(k)}>
                  {downloadLabel(k)} · {v}
                </Badge>
              ))}
            </div>
          ) : (
            <EmptyLine text="暂无下载任务" />
          )}
        </Card>

        {/* 磁盘 */}
        <Card>
          <SectionTitle icon={HardDrive} title="磁盘" />
          <dl className="space-y-3">
            <Row label="剩余空间" value={formatBytes(m.disk.freeBytes)} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[var(--color-surface-2)] text-[var(--color-text-soft)]',
    info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
    success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
    danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--color-muted)]">{label}</span>
        <span className={`flex size-8 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-[var(--color-text)]">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-faint)]">{sub}</div>
    </Card>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: { text: string; tone: 'success' | 'danger' | 'info' | 'warning' | 'neutral' };
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-[var(--color-faint)]" />
        <h2 className="font-medium text-[var(--color-text)]">{title}</h2>
      </div>
      {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-medium text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="py-2 text-sm text-[var(--color-faint)]">{text}</div>;
}

function jobTone(s: string): 'success' | 'danger' | 'info' | 'neutral' {
  if (s === 'success') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'running') return 'info';
  return 'neutral';
}
function jobLabel(s: string): string {
  return { success: '成功', failed: '失败', running: '运行中', queued: '排队' }[s] ?? s;
}
function downloadTone(s: string): 'success' | 'danger' | 'info' | 'warning' | 'neutral' {
  if (['COMPLETED', 'RENAMED', 'EXPORTED'].includes(s)) return 'success';
  if (['ERROR', 'FAILED', 'ABANDONED'].includes(s)) return 'danger';
  if (['DOWNLOADING'].includes(s)) return 'info';
  if (['PAUSED', 'MATCHED', 'REVIEWED'].includes(s)) return 'warning';
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
    }[s] ?? s
  );
}
