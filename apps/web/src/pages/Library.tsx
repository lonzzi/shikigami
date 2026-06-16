import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, RefreshCw } from 'lucide-react';
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((s) => (
            <Card key={s.id} className="space-y-3">
              <div className="flex gap-3">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[var(--color-sakura-soft)] to-[var(--color-primary-soft)]">
                  {s.posterUrl ? (
                    <img src={s.posterUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Film className="size-7 text-[var(--color-primary)]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[var(--color-text)]">
                    {s.titleCn ?? s.titleJp}
                  </div>
                  {s.titleCn && (
                    <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                      {s.titleJp}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.year && <Badge tone="neutral">{s.year}</Badge>}
                    <Badge tone="info">{s._count?.mediaFiles ?? 0} 集</Badge>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 border-t border-[var(--color-border)] pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  loading={rescrape.isPending}
                  onClick={() => rescrape.mutate({ id: s.id, force: false })}
                >
                  <RefreshCw className="size-3.5" /> 重新刮削
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => rescrape.mutate({ id: s.id, force: true })}
                >
                  强制覆盖
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
