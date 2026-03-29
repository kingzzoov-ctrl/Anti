import { Outlet, useNavigate, useRouter } from '@tanstack/react-router'
import {
  LayoutDashboard,
  FlaskConical,
  FileText,
  Radar,
  MessageCircle,
  Settings,
  LogOut,
  Coins,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useUserProfile } from '../../hooks/useUserProfile'
import { authApi } from '../../lib/localApi'
import { useEffect, useState } from 'react'
import { fetchReports, fetchRuntimeConfigs, fetchThreads } from '../../lib/ariadneApi'

interface ShellGovernanceState {
  reportCount: number
  latestChapterCount: number
  hasStructuredReport: boolean
  threadCount: number
  adminConfigReady: boolean
}

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: 'The Lab', path: '/lab', icon: <FlaskConical className="h-4 w-4" /> },
  { label: 'Insight', path: '/insight', icon: <FileText className="h-4 w-4" /> },
  { label: 'Discovery', path: '/discovery', icon: <Radar className="h-4 w-4" /> },
  { label: 'The Thread', path: '/thread', icon: <MessageCircle className="h-4 w-4" /> },
]

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}

function SidebarNavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-primary/10 text-primary border border-primary/20'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function AriadneSidebar() {
  const { user } = useAuth()
  const { profile } = useUserProfile(user?.id ?? null)
  const navigate = useNavigate()
  const router = useRouter()
  const currentPath = router.state.location.pathname
  const [governanceState, setGovernanceState] = useState<ShellGovernanceState>({
    reportCount: 0,
    latestChapterCount: 0,
    hasStructuredReport: false,
    threadCount: 0,
    adminConfigReady: false,
  })

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      try {
        const [reports, threads, runtimeConfigs] = await Promise.all([
          fetchReports(user.id),
          fetchThreads(user.id),
          fetchRuntimeConfigs(),
        ])

        let latestChapterCount = 0
        let hasStructuredReport = false

        if (reports.length > 0) {
          const report = reports[0] as { rawContent?: string | Record<string, unknown> }
          try {
            const raw = typeof report.rawContent === 'string' ? JSON.parse(report.rawContent) : (report.rawContent ?? {})
            const chapters = Array.isArray((raw as Record<string, unknown>).chapters) ? (raw as Record<string, unknown>).chapters as unknown[] : []
            latestChapterCount = chapters.length
            hasStructuredReport = chapters.length > 0
          } catch {
            latestChapterCount = 0
            hasStructuredReport = false
          }
        }

        const configMap = new Map((runtimeConfigs as Array<{ key?: string; value?: string }>).map((item) => [item.key, item.value]))
        const adminConfigReady = Boolean(configMap.get('RUNTIME_FN_INTERVIEW_URL') && configMap.get('RUNTIME_FN_MATCH_URL'))

        setGovernanceState({
          reportCount: reports.length,
          latestChapterCount,
          hasStructuredReport,
          threadCount: threads.length,
          adminConfigReady,
        })
      } catch {
        // ignore
      }
    }
    load()
  }, [user?.id])

  const handleLogout = () => {
    authApi.logout()
  }

  const displayName = profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User'
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div className="flex h-full flex-col border-r border-border bg-card/70 backdrop-blur">
      <div className="border-b border-border px-4 py-4">
        <div className="px-2 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold gradient-text tracking-widest" style={{ fontFamily: 'var(--font-serif)' }}>
              ARIADNE
            </span>
            <span className="text-[10px] text-muted-foreground tracking-[0.2em] uppercase">
              心智图谱 · 感知引擎
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          {navItems.map((item) => (
            <SidebarNavItem
              key={item.path}
              icon={item.icon}
              label={item.label}
              active={currentPath === item.path || currentPath.startsWith(item.path + '/')}
              onClick={() => navigate({ to: item.path })}
            />
          ))}

          {profile?.isAdmin && (
            <>
              <div className="my-3 border-t border-border/70" />
              <SidebarNavItem
                icon={<Settings className="h-4 w-4" />}
                label="Admin"
                active={currentPath === '/admin'}
                onClick={() => navigate({ to: '/admin' })}
              />
            </>
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-4">
        <div className="space-y-3 px-2 py-3">
          {/* Token balance */}
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-muted/50">
            <Coins className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">余额</span>
            <span className={`text-xs font-mono font-semibold ml-auto ${(profile?.tokenBalance ?? 0) < 20 ? 'text-destructive' : 'text-primary'}`}>
              {profile?.tokenBalance ?? 0}
            </span>
          </div>

          <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>全局状态</span>
              <span>{governanceState.adminConfigReady ? 'Ready' : 'Pending'}</span>
            </div>
            <div className="space-y-1.5 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>章节化报告</span>
                <span className={governanceState.hasStructuredReport ? 'text-primary' : 'text-muted-foreground'}>
                  {governanceState.hasStructuredReport ? `${governanceState.latestChapterCount} 章` : '未生成'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Thread 连接</span>
                <span>{governanceState.threadCount}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>运行时路由</span>
                <span className={governanceState.adminConfigReady ? 'text-primary' : 'text-destructive'}>
                  {governanceState.adminConfigReady ? '已配置' : '待治理'}
                </span>
              </div>
            </div>
          </div>

          {/* User info */}
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs text-primary">
                {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
              <StatusBadge>
                {profile?.tier ?? 'Free'}
              </StatusBadge>
            </div>
            <button
              type="button"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppShellLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-80 shrink-0 md:block">
        <AriadneSidebar />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="h-full w-80 max-w-[85vw] bg-background" onClick={(event) => event.stopPropagation()}>
            <AriadneSidebar />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground"
            aria-label="Open navigation"
          >
            <span className="flex flex-col gap-1">
              <span className="block h-0.5 w-4 bg-current" />
              <span className="block h-0.5 w-4 bg-current" />
              <span className="block h-0.5 w-4 bg-current" />
            </span>
          </button>
          <span className="font-bold gradient-text tracking-widest text-sm" style={{ fontFamily: 'var(--font-serif)' }}>
            ARIADNE
          </span>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
