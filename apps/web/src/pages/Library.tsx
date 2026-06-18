import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, SectionHeader } from '@/components/ui/primitives';
import { authHeaders, rpc } from '@/lib/api';

type Series = {
  id: string;
  titleJp: string;
  titleCn: string | null;
  year: number | null;
  posterUrl: string | null;
  tmdbId?: number | null;
  _count?: { mediaFiles: number };
};

export function LibraryPage() {
  const qc = useQueryClient();
  const { data } = useQuery<Series[]>({
    queryKey: ['library'],
    queryFn: async () => (await rpc.api.library.$get()).json(),
  });

  const rescrape = useMutation({
    mutationFn: async ({ id, force }: { id: string; force: boolean }) => {
      const tid = toast.loading(force ? '强制重新刮削…' : '重新刮削…');
      try {
        const res = await fetch(`/api/library/${id}/rescrape${force ? '?force=true' : ''}`, {
          method: 'POST',
          headers: authHeaders(),
        });
        const d: any = await res.json();
        toast.success(`已入队 ${d.queued} 个文件`, { id: tid });
      } catch {
        toast.error('刮削失败', { id: tid });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });

  // 手动补 TMDB（Bangumi-only 或缺 TMDB 数据的 Series）
  const backfillTmdb = useMutation({
    mutationFn: async (id: string) => {
      const res = await rpc.api.series[':id']['backfill-tmdb'].$post({ param: { id } });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(e.message ?? 'tmdb_unavailable');
      }
      return res.json();
    },
    onSuccess: (d: any) => {
      if (d.ok) toast.success('已补全 TMDB 元数据');
      else toast.info('未找到匹配的 TMDB 条目');
      qc.invalidateQueries({ queryKey: ['library'] });
    },
    onError: (e: Error) =>
      toast.error(e.message === 'tmdb_unavailable' ? 'TMDB 不可用（检查 API Key）' : '补全失败'),
  });

  return (
    <div className="space-y-6">
      <SectionHeader title="媒体库" desc="已刮削入库的番剧" />

      {data && data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Film}
            title="媒体库为空"
            desc="下载完成并经过 AI 刮削的番剧会出现在这里"
          />
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data?.map((s, i) => (
            <Card
              key={s.id}
              className="stagger group flex flex-col overflow-hidden p-0"
              style={{ ['--i' as string]: i }}
            >
              {/* 海报 */}
              <div className="relative aspect-[2/3] w-full overflow-hidden bg-gradient-to-br from-[var(--color-sakura-soft)] to-[var(--color-primary-soft)]">
                {s.posterUrl ? (
                  <img
                    src={s.posterUrl}
                    alt={s.titleCn ?? s.titleJp}
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Film className="size-10 text-[var(--color-primary)]/40" />
                  </div>
                )}
                <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1.5">
                  {s.year && (
                    <Badge
                      tone="neutral"
                      className="bg-[var(--color-ink)]/70 text-white backdrop-blur-sm"
                    >
                      {s.year}
                    </Badge>
                  )}
                  {s.tmdbId ? (
                    <a
                      href={`https://www.themoviedb.org/tv/${s.tmdbId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 TMDB 查看"
                      className="inline-flex"
                    >
                      <Badge tone="success" className="backdrop-blur-sm">
                        TMDB ↗
                      </Badge>
                    </a>
                  ) : (
                    <Badge tone="warning" className="backdrop-blur-sm">
                      未绑 TMDB
                    </Badge>
                  )}
                </div>
              </div>

              {/* 信息 */}
              <div className="flex flex-1 flex-col p-3.5">
                <div className="truncate font-display text-[0.95rem] font-semibold text-[var(--color-ink)]">
                  {s.titleCn ?? s.titleJp}
                </div>
                {s.titleCn && (
                  <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                    {s.titleJp}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <Badge tone="info">{s._count?.mediaFiles ?? 0} 集</Badge>
                </div>

                <div className="mt-auto flex gap-1.5 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    loading={rescrape.isPending}
                    onClick={() => rescrape.mutate({ id: s.id, force: false })}
                  >
                    <RefreshCw className="size-3.5" /> 重新刮削
                  </Button>
                  {!s.tmdbId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={backfillTmdb.isPending}
                      onClick={() => backfillTmdb.mutate(s.id)}
                      title="按标题搜 TMDB 并回填元数据"
                    >
                      <Sparkles className="size-3.5" /> 补 TMDB
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => rescrape.mutate({ id: s.id, force: true })}
                  >
                    强制
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default LibraryPage;
