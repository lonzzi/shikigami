import type { QueryClient } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  redirect,
} from '@tanstack/react-router';
import { AppLayout } from '@/components/AppLayout';
import { getToken } from '@/lib/api';
import { DashboardPage } from '@/pages/Dashboard';
import { LibraryPage } from '@/pages/Library';
import { LoginPage } from '@/pages/Login';
import { ScrapeReviewPage } from '@/pages/ScrapeReview';
import { SettingsPage } from '@/pages/Settings';
import { SubscriptionsPage } from '@/pages/Subscriptions';
import { TasksPage } from '@/pages/Tasks';

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

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: requireAuth,
  component: DashboardPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const subscriptionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/subscriptions',
  beforeLoad: requireAuth,
  component: SubscriptionsPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  beforeLoad: requireAuth,
  component: TasksPage,
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  beforeLoad: requireAuth,
  component: LibraryPage,
});

const scrapeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scrape',
  beforeLoad: requireAuth,
  component: ScrapeReviewPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: requireAuth,
  component: SettingsPage,
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
