import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { clearToken } from './lib/api';
import { routeTree } from './routes';
import './index.css';

// 全局响应拦截: 任意 query 收到 401 → 清 token + 跳登录
// (避免过期/失效 token 卡在"加载中"页面)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      const msg = (error as Error)?.message ?? '';
      if (msg.includes('401')) {
        clearToken();
        toast.error('登录已过期，请重新登录');
        if (location.pathname !== '/login') location.assign('/login');
      }
    },
  }),
});

const router = createRouter({ routeTree, defaultPreload: 'intent', context: { queryClient } });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
        <Toaster theme="light" position="top-right" toastOptions={{ className: 'sonner-toast' }} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
