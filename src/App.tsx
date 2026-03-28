import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { AppShellLayout } from './components/layout/AppShell'
import DashboardPage from './pages/DashboardPage'
import LabPage from './pages/LabPage'
import InsightPage from './pages/InsightPage'
import InsightReportPage from './pages/InsightReportPage'
import DiscoveryPage from './pages/DiscoveryPage'
import ThreadPage from './pages/ThreadPage'
import ThreadDetailPage from './pages/ThreadDetailPage'
import AdminPage from './pages/AdminPage'
import { blink } from './blink/client'

// Root route
const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

// Auth guard helper
function requireAuth() {
  if (!blink.auth.isAuthenticated()) {
    blink.auth.login()
    throw redirect({ to: '/' })
  }
}

// Index route — redirect to dashboard or show loading
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    if (blink.auth.isAuthenticated()) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: LandingRedirect,
})

function LandingRedirect() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <h1 className="text-4xl font-bold gradient-text mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
          ARIADNE
        </h1>
        <p className="text-muted-foreground mb-8 text-sm tracking-widest uppercase">
          心智图谱 · 深度问询系统
        </p>
        <button
          onClick={() => blink.auth.login()}
          className="px-8 py-3 rounded-lg bg-primary text-primary-foreground font-semibold glow-primary transition-all hover:opacity-90"
        >
          进入系统
        </button>
      </div>
    </div>
  )
}

// Layout route — wraps all protected pages
const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  beforeLoad: () => requireAuth(),
  component: AppShellLayout,
})

// Dashboard
const dashboardRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/dashboard',
  component: DashboardPage,
})

// Lab — list
const labRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/lab',
  component: LabPage,
})

// Lab — session
const labSessionRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/lab/$sessionId',
  component: LabPage,
})

// Insight — list
const insightRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/insight',
  component: InsightPage,
})

// Insight — report
const insightReportRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/insight/$reportId',
  component: InsightReportPage,
})

// Discovery
const discoveryRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/discovery',
  component: DiscoveryPage,
})

// Thread — list
const threadRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/thread',
  component: ThreadPage,
})

// Thread — detail
const threadDetailRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/thread/$threadId',
  component: ThreadDetailPage,
})

// Admin
const adminRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/admin',
  component: AdminPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  layoutRoute.addChildren([
    dashboardRoute,
    labRoute,
    labSessionRoute,
    insightRoute,
    insightReportRoute,
    discoveryRoute,
    threadRoute,
    threadDetailRoute,
    adminRoute,
  ]),
])

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return <RouterProvider router={router} />
}
