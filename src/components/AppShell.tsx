import { Outlet, useNavigate, useRouter } from '@tanstack/react-router'
import {
  AppShell,
  AppShellSidebar,
  AppShellMain,
  MobileSidebarTrigger,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarItem,
  SidebarSeparator,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
} from '@blinkdotnew/ui'
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
import { blink } from '../../blink/client'

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: 'The Lab', path: '/lab', icon: <FlaskConical className="h-4 w-4" /> },
  { label: 'Insight', path: '/insight', icon: <FileText className="h-4 w-4" /> },
  { label: 'Discovery', path: '/discovery', icon: <Radar className="h-4 w-4" /> },
  { label: 'The Thread', path: '/thread', icon: <MessageCircle className="h-4 w-4" /> },
]

function AriadneSidebar() {
  const { user } = useAuth()
  const { profile } = useUserProfile(user?.id ?? null)
  const navigate = useNavigate()
  const router = useRouter()
  const currentPath = router.state.location.pathname

  const handleLogout = () => {
    blink.auth.logout()
  }

  const displayName = profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User'
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <Sidebar>
      <SidebarHeader>
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
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {navItems.map((item) => (
            <SidebarItem
              key={item.path}
              icon={item.icon}
              label={item.label}
              active={currentPath === item.path || currentPath.startsWith(item.path + '/')}
              onClick={() => navigate({ to: item.path })}
            />
          ))}

          {profile?.isAdmin && (
            <>
              <SidebarSeparator />
              <SidebarItem
                icon={<Settings className="h-4 w-4" />}
                label="Admin"
                active={currentPath === '/admin'}
                onClick={() => navigate({ to: '/admin' })}
              />
            </>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-3 space-y-3">
          {/* Token balance */}
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-muted/50">
            <Coins className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">余额</span>
            <span className={`text-xs font-mono font-semibold ml-auto ${(profile?.tokenBalance ?? 0) < 20 ? 'text-destructive' : 'text-primary'}`}>
              {profile?.tokenBalance ?? 0}
            </span>
          </div>

          {/* User info */}
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs bg-primary/20 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
              <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-border text-muted-foreground">
                {profile?.tier ?? 'Free'}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

export function AppShellLayout() {
  return (
    <AppShell>
      <AppShellSidebar>
        <AriadneSidebar />
      </AppShellSidebar>
      <AppShellMain>
        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-3 px-4 h-14 border-b border-border bg-background sticky top-0 z-30">
          <MobileSidebarTrigger />
          <span className="font-bold gradient-text tracking-widest text-sm" style={{ fontFamily: 'var(--font-serif)' }}>
            ARIADNE
          </span>
        </div>
        <Outlet />
      </AppShellMain>
    </AppShell>
  )
}
