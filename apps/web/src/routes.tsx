import type { QueryClient } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { AppLayout } from '@/components/AppLayout';
import { getToken } from '@/lib/api';

/** 受保护路由的 beforeLoad: 未登录则重定向到 /login。 */
const requireAuth = () => {
  if (!getToken()) throw redirect({ to: '/login' });
};

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppLayout,
});

// 路由级懒加载: 首屏（登录页）只打包 react + login，其余页面按需加载，
// 显著减小首包体积。TanStack Router 会自动用 Suspense 处理加载态。
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('@/pages/Dashboard')),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: lazyRouteComponent(() => import('@/pages/Login')),
});

const subscriptionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/subscriptions',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('@/pages/Subscriptions')),
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('@/pages/Tasks')),
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('@/pages/Library')),
});

const scrapeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scrape',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('@/pages/ScrapeReview')),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('@/pages/Settings')),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  subscriptionsRoute,
  tasksRoute,
  libraryRoute,
  scrapeRoute,
  settingsRoute,
]);

export { createHashHistory };
