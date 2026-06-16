import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Download,
  Film,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { useEffect } from 'react';
import { clearToken, getToken } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAV_GROUPS = [
  {
    items: [
      { to: '/', label: '仪表盘', icon: LayoutDashboard },
      { to: '/subscriptions', label: '订阅', icon: ListChecks },
      { to: '/tasks', label: '下载任务', icon: Download },
    ],
  },
  {
    label: '内容',
    items: [
      { to: '/library', label: '媒体库', icon: Film },
      { to: '/scrape', label: '刮削确认', icon: Sparkles },
    ],
  },
  {
    items: [{ to: '/settings', label: '设置', icon: SettingsIcon }],
  },
];

export function AppLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const hasToken = !!getToken();
    if (!hasToken && pathname !== '/login') navigate({ to: '/login' });
    else if (hasToken && pathname === '/login') navigate({ to: '/' });
  }, [pathname, navigate]);

  const onLogout = () => {
    clearToken();
    navigate({ to: '/login' });
  };

  if (pathname === '/login') return <Outlet />;

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="brush seal flex size-8 items-center justify-center rounded-md text-base">
            式
          </span>
          <div className="leading-tight">
            <div className="brush text-base font-semibold text-[var(--color-text)]">式神</div>
            <div className="text-[10px] font-medium tracking-[0.2em] text-[var(--color-faint)]">
              SHIKIGAMI
            </div>
          </div>
        </div>

        {/* 导航(分组) */}
        <nav className="flex-1 space-y-4 px-3 py-4">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="space-y-0.5">
              {group.label && (
                <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-all',
                      active
                        ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                        : 'text-[var(--color-text-soft)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]',
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]" />
                    )}
                    <Icon
                      size={17}
                      className={cn(
                        !active &&
                          'text-[var(--color-faint)] group-hover:text-[var(--color-muted)]',
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 退出 */}
        <div className="border-t border-[var(--color-border)] p-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm font-medium text-[var(--color-text-soft)] transition-colors hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
          >
            <LogOut size={17} /> 退出登录
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-[var(--color-bg)]">
        <div className="fade-in mx-auto max-w-6xl p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
