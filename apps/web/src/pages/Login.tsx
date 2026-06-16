import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/primitives';
import { login } from '@/lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const tid = toast.loading('登录中…');
    try {
      const ok = await login(username, password);
      if (ok) {
        toast.success('欢迎回来', { id: tid });
        navigate({ to: '/' });
      } else {
        toast.error('用户名或密码错误', { id: tid });
      }
    } catch {
      toast.error('登录失败，请检查后端是否运行', { id: tid });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="fade-in w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="brush seal mx-auto mb-4 flex size-14 items-center justify-center rounded-xl text-2xl">
            式
          </span>
          <h1 className="brush text-2xl font-semibold text-[var(--color-text)]">式神 Shikigami</h1>
          <p className="mt-1.5 text-sm text-[var(--color-muted)]">动漫 BT · AI 刮削 · 自托管工具</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <Label>用户名</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <Label>密码</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" loading={loading} className="w-full" size="lg">
            登录
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--color-faint)]">
          默认账号 admin · 密码见 .env 的 ADMIN_PASSWORD
        </p>
      </div>
    </div>
  );
}
