import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, Input, Label, SectionHeader } from '@/components/ui/primitives';
import { rpc } from '@/lib/api';

const FIELDS: {
  key: string;
  label: string;
  group: string;
  secret?: boolean;
  placeholder?: string;
}[] = [
  {
    key: 'LLM_BASE_URL',
    label: 'API 地址',
    group: 'AI 刮削',
    placeholder: 'https://api.openai.com/v1',
  },
  { key: 'LLM_API_KEY', label: 'API Key', group: 'AI 刮削', secret: true, placeholder: 'sk-...' },
  { key: 'LLM_MODEL', label: '模型', group: 'AI 刮削', placeholder: 'glm-5.1' },
  {
    key: 'QBT_BASE_URL',
    label: 'qBittorrent 地址',
    group: '下载器',
    placeholder: 'http://localhost:16280',
  },
  { key: 'QBT_USERNAME', label: '用户名', group: '下载器' },
  { key: 'QBT_PASSWORD', label: '密码', group: '下载器', secret: true },
  { key: 'TMDB_API_KEY', label: 'TMDB API Key', group: '元数据', secret: true },
];

const GROUPS = [...new Set(FIELDS.map((f) => f.group))];

export function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: async () => (await rpc.api.settings.$get()).json(),
  });
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      const init: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = data[f.key];
        init[f.key] = v ?? '';
      }
      setForm(init);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const updates: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = form[f.key];
        if (v && v !== '' && v !== '***') updates[f.key] = v;
      }
      if (Object.keys(updates).length === 0) {
        toast.info('没有需要保存的改动');
        return;
      }
      const tid = toast.loading('保存中…');
      try {
        await rpc.api.settings.$put({ json: updates });
        toast.success(`已保存 ${Object.keys(updates).length} 项配置`, { id: tid });
        qc.invalidateQueries({ queryKey: ['settings'] });
      } catch {
        toast.error('保存失败', { id: tid });
      }
    },
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="设置"
        desc="当前配置从 .env 读取，修改后写入数据库覆盖"
        action={
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="size-4" /> 保存
          </Button>
        }
      />

      <div className="space-y-4">
        {GROUPS.map((g) => (
          <Card key={g} className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
              {g}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.filter((f) => f.group === g).map((f) => (
                <div key={f.key}>
                  <Label>{f.label}</Label>
                  <Input
                    type={f.secret ? 'password' : 'text'}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={
                      f.placeholder ?? (data?.[f.key] === '***' ? '••••（已设置，留空不改）' : '')
                    }
                  />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
