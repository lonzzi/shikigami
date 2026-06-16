import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Input, SectionHeader } from '@/components/ui/primitives';
import { rpc } from '@/lib/api';

type PendingFile = {
  id: string;
  fileName: string;
  scrapeState: string;
  scrapeResult: string | null;
  series?: { titleCn: string | null; titleJp: string } | null;
};

export function ScrapeReviewPage() {
  const qc = useQueryClient();
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<any>(null);

  const { data } = useQuery<PendingFile[]>({
    queryKey: ['scrape-pending'],
    queryFn: async () => (await rpc.api.scrape.pending.$get()).json(),
    refetchInterval: 10_000,
  });

  const previewM = useMutation({
    mutationFn: async () => {
      const tid = toast.loading('AI 识别中…');
      try {
        const d: any = await (await rpc.api.scrape.preview.$post({ json: { filename } })).json();
        setPreview(d);
        toast.success('识别完成', { id: tid });
      } catch {
        toast.error('识别失败（检查 LLM API Key 是否配置）', { id: tid });
      }
    },
  });

  const reviewM = useMutation({
    mutationFn: async ({ id, meta }: { id: string; meta: any }) => {
      const tid = toast.loading('确认并重命名…');
      try {
        await rpc.api.scrape[':mediaFileId'].review.$post({
          param: { mediaFileId: id },
          json: { meta, force: true },
        });
        toast.success('已确认并入库', { id: tid });
      } catch {
        toast.error('入库失败', { id: tid });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['scrape-pending'] }),
  });

  return (
    <div className="space-y-6">
      <SectionHeader title="刮削确认" desc="AI 识别置信度低或失败的文件，需人工确认" />

      {/* 试刮削 */}
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
          <Wand2 className="size-4 text-[var(--color-primary)]" /> 试刮削
        </div>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="[ANi] Sousou no Frieren - 01 [1080p][CHT].mkv"
          />
          <Button
            loading={previewM.isPending}
            onClick={() => previewM.mutate()}
            disabled={!filename}
          >
            识别
          </Button>
        </div>
        {preview?.meta && (
          <div className="rounded-lg bg-[var(--color-surface-2)] p-4">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {preview.meta.release_group && (
                <Badge tone="primary">{preview.meta.release_group}</Badge>
              )}
              {preview.meta.absolute_episode != null && (
                <Badge tone="neutral">ABS {preview.meta.absolute_episode}</Badge>
              )}
              {preview.meta.season && preview.meta.episode && (
                <Badge tone="info">
                  S{preview.meta.season}E{preview.meta.episode}
                </Badge>
              )}
              {preview.meta.resolution && <Badge tone="neutral">{preview.meta.resolution}</Badge>}
              {preview.meta.episode_type && (
                <Badge tone="neutral">{preview.meta.episode_type}</Badge>
              )}
              <Badge tone={preview.meta.needs_review ? 'warning' : 'success'}>
                置信 {(preview.meta.confidence ?? 0).toFixed(2)}
              </Badge>
            </div>
            <div className="text-xs text-[var(--color-muted)]">
              {preview.meta.needs_review ? '⚠️ 置信度较低，建议人工核对' : '✓ 识别可信'}
            </div>
          </div>
        )}
      </Card>

      {/* 待确认队列 */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-medium text-[var(--color-text)]">待人工确认</h2>
          <Badge tone={data && data.length > 0 ? 'warning' : 'neutral'}>{data?.length ?? 0}</Badge>
        </div>
        {data && data.length === 0 ? (
          <Card>
            <EmptyState
              icon={Sparkles}
              title="全部就绪"
              desc="没有待确认的文件，AI 刮削都在顺利运行 🎉"
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {data?.map((f) => {
              const meta = f.scrapeResult ? JSON.parse(f.scrapeResult) : null;
              return (
                <Card key={f.id} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm text-[var(--color-text)]">
                        {f.fileName}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                        <Badge tone={f.scrapeState === 'FAILED' ? 'danger' : 'warning'}>
                          {f.scrapeState === 'FAILED' ? '识别失败' : '待确认'}
                        </Badge>
                        {f.series && <span>→ {f.series.titleCn ?? f.series.titleJp}</span>}
                      </div>
                      {meta && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {meta.release_group && <Badge tone="primary">{meta.release_group}</Badge>}
                          {meta.absolute_episode != null && (
                            <Badge tone="neutral">ABS {meta.absolute_episode}</Badge>
                          )}
                          {meta.resolution && <Badge tone="neutral">{meta.resolution}</Badge>}
                          <Badge tone={meta.confidence < 0.5 ? 'danger' : 'warning'}>
                            置信 {(meta.confidence ?? 0).toFixed(2)}
                          </Badge>
                        </div>
                      )}
                    </div>
                    {meta && (
                      <Button
                        size="sm"
                        loading={reviewM.isPending}
                        onClick={() => reviewM.mutate({ id: f.id, meta })}
                      >
                        <Check className="size-3.5" /> 确认入库
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
