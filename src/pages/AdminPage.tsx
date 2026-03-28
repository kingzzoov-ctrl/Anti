import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  toast,
} from '@blinkdotnew/ui'
import {
  Settings,
  Users,
  FlaskConical,
  FileText,
  GitMerge,
  Save,
  ChevronDown,
  ChevronRight,
  Shield,
  Eye,
  Coins,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useUserProfile'
import { blink } from '../blink/client'
import type { SystemConfig, InterviewSession } from '../types'

type StatusFilter = 'ALL' | 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED' | 'GENERATING_REPORT'
type UserTier = 'Free' | 'Ad-Reward' | 'Premium'

interface ExposureLog {
  id: string
  userId: string
  date: string
  dailyExposureCount: string | number
}

interface RawProfile {
  id: string
  userId: string
  displayName?: string
  tier: UserTier
  tokenBalance: string | number
  matchingEnabled: boolean | string | number
  isAdmin: boolean | string | number
  createdAt: string
  updatedAt: string
}

export default function AdminPage() {
  const { user } = useAuth()
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id ?? null)
  const navigate = useNavigate()

  const [configs, setConfigs] = useState<SystemConfig[]>([])
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({})
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [showBadCaseOnly, setShowBadCaseOnly] = useState(false)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [stats, setStats] = useState({ users: 0, sessions: 0, reports: 0, matches: 0, todayExposures: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Exposure logs
  const [exposureLogs, setExposureLogs] = useState<ExposureLog[]>([])

  // User profiles for tier management
  const [userProfiles, setUserProfiles] = useState<RawProfile[]>([])
  const [addTokenInputs, setAddTokenInputs] = useState<Record<string, string>>({})
  const [showTokenInput, setShowTokenInput] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState<string | null>(null)

  // Redirect if not admin
  useEffect(() => {
    if (!profileLoading && profile && !profile.isAdmin) {
      navigate({ to: '/dashboard' })
    }
  }, [profile, profileLoading, navigate])

  useEffect(() => {
    if (!profile?.isAdmin) return
    const load = async () => {
      setIsLoading(true)
      try {
        const [rawConfigs, rawSessions, rawReports, rawMatches, rawProfiles, rawExposureLogs] = await Promise.all([
          blink.db.systemConfigs.list({ limit: 100 }),
          blink.db.interviewSessions.list({ orderBy: { createdAt: 'desc' }, limit: 100 }),
          blink.db.insightReports.list({ limit: 1 }),
          blink.db.matchRecords.list({ limit: 1 }),
          blink.db.userProfiles.list({ limit: 200 }),
          blink.db.exposureLogs.list({ orderBy: { date: 'desc' }, limit: 100 }),
        ])

        setConfigs(rawConfigs as unknown as SystemConfig[])
        setSessions(rawSessions.map(s => ({
          ...s,
          messages: typeof (s as unknown as { messages: string | unknown[] }).messages === 'string'
            ? JSON.parse((s as unknown as { messages: string }).messages || '[]')
            : ((s as unknown as { messages: unknown[] }).messages ?? []),
        })) as unknown as InterviewSession[])

        const logsTyped = rawExposureLogs as unknown as ExposureLog[]
        setExposureLogs(logsTyped)
        setUserProfiles(rawProfiles as unknown as RawProfile[])

        // Compute today's exposures
        const today = new Date().toISOString().split('T')[0]
        const todayExposures = logsTyped
          .filter(e => e.date === today)
          .reduce((sum, e) => sum + Number(e.dailyExposureCount), 0)

        // Get actual counts
        const [sessCount, repCount, matchCount] = await Promise.all([
          blink.db.interviewSessions.count({}),
          blink.db.insightReports.count({}),
          blink.db.matchRecords.count({}),
        ])
        setStats({
          users: rawProfiles.length,
          sessions: sessCount,
          reports: repCount,
          matches: matchCount,
          todayExposures,
        })
      } catch {
        // ignore
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [profile?.isAdmin])

  const reloadProfiles = async () => {
    try {
      const rawProfiles = await blink.db.userProfiles.list({ limit: 200 })
      setUserProfiles(rawProfiles as unknown as RawProfile[])
      setStats(prev => ({ ...prev, users: rawProfiles.length }))
    } catch {
      // ignore
    }
  }

  const handleSaveConfig = async (key: string) => {
    const newVal = configEdits[key]
    if (newVal === undefined) return
    setSavingKey(key)
    try {
      await blink.db.systemConfigs.update(key, {
        value: newVal,
        updatedAt: new Date().toISOString(),
      })
      setConfigs(prev => prev.map(c => c.key === key ? { ...c, value: newVal } : c))
      toast.success(`已保存 ${key}`)
    } catch {
      toast.error('保存失败')
    } finally {
      setSavingKey(null)
    }
  }

  const handleIncrementPromptVersion = async (key: string) => {
    const config = configs.find(c => c.key === key)
    if (!config) return
    const currentVal = configEdits[key] ?? config.value
    const currentNum = parseInt(currentVal, 10)
    const nextNum = isNaN(currentNum) ? 1 : currentNum + 1
    const nextVal = String(nextNum)
    setSavingKey(key)
    try {
      await blink.db.systemConfigs.update(key, {
        value: nextVal,
        updatedAt: new Date().toISOString(),
      })
      setConfigs(prev => prev.map(c => c.key === key ? { ...c, value: nextVal } : c))
      setConfigEdits(prev => ({ ...prev, [key]: nextVal }))
      toast.success(`Prompt 版本已更新为 v${nextNum}`)
    } catch {
      toast.error('更新失败')
    } finally {
      setSavingKey(null)
    }
  }

  const handleAddTokens = async (profileId: string) => {
    const amountStr = addTokenInputs[profileId]
    const amount = parseInt(amountStr, 10)
    if (isNaN(amount) || amount <= 0) {
      toast.error('请输入有效数量')
      return
    }
    const prof = userProfiles.find(p => p.id === profileId)
    if (!prof) return
    const newBalance = Number(prof.tokenBalance) + amount
    setSavingProfile(profileId)
    try {
      await blink.db.userProfiles.update(profileId, {
        tokenBalance: String(newBalance),
        updatedAt: new Date().toISOString(),
      })
      toast.success(`已充值 ${amount} Token`)
      setShowTokenInput(null)
      setAddTokenInputs(prev => ({ ...prev, [profileId]: '' }))
      await reloadProfiles()
    } catch {
      toast.error('充值失败')
    } finally {
      setSavingProfile(null)
    }
  }

  const handleChangeTier = async (profileId: string, tier: UserTier) => {
    setSavingProfile(profileId)
    try {
      await blink.db.userProfiles.update(profileId, {
        tier,
        updatedAt: new Date().toISOString(),
      })
      toast.success(`已更新为 ${tier}`)
      await reloadProfiles()
    } catch {
      toast.error('更新失败')
    } finally {
      setSavingProfile(null)
    }
  }

  const handleToggleAdmin = async (profileId: string, current: boolean) => {
    setSavingProfile(profileId)
    try {
      await blink.db.userProfiles.update(profileId, {
        isAdmin: !current,
        updatedAt: new Date().toISOString(),
      })
      toast.success(current ? '已取消管理员权限' : '已授予管理员权限')
      await reloadProfiles()
    } catch {
      toast.error('操作失败')
    } finally {
      setSavingProfile(null)
    }
  }

  // Bad-case: COMPLETED + turnCount < 8
  const badCaseIds = new Set(
    sessions.filter(s => s.status === 'COMPLETED' && (s.turnCount ?? 0) < 8).map(s => s.id)
  )
  const filteredSessions = sessions.filter(s => {
    const statusOk = statusFilter === 'ALL' || s.status === statusFilter
    const badCaseOk = !showBadCaseOnly || badCaseIds.has(s.id)
    return statusOk && badCaseOk
  })

  // Exposure logs sorted by date desc, then count desc
  const sortedLogs = [...exposureLogs].sort((a, b) => {
    if (b.date > a.date) return 1
    if (b.date < a.date) return -1
    return Number(b.dailyExposureCount) - Number(a.dailyExposureCount)
  })
  const today = new Date().toISOString().split('T')[0]
  const todayTotal = exposureLogs
    .filter(e => e.date === today)
    .reduce((sum, e) => sum + Number(e.dailyExposureCount), 0)

  // Prompt version configs
  const PROMPT_VERSION_KEYS = ['PROMPT_VERSION_INTERVIEW', 'PROMPT_VERSION_REPORT', 'PROMPT_VERSION_MATCH']
  const promptVersionConfigs = configs.filter(c => PROMPT_VERSION_KEYS.includes(c.key))
  const regularConfigs = configs.filter(c => !PROMPT_VERSION_KEYS.includes(c.key))

  const tierColorMap: Record<UserTier, string> = {
    Free: 'border-border text-muted-foreground',
    'Ad-Reward': 'border-[hsl(45,90%,55%)]/50 text-[hsl(45,90%,65%)]',
    Premium: 'border-primary/50 text-primary',
  }

  if (profileLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!profile?.isAdmin) return null

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: 'var(--font-serif)' }}>
            管理控制台
          </h1>
          <p className="text-muted-foreground text-xs mt-0.5">系统监控 · 配置管理</p>
        </div>
        <Badge variant="outline" className="ml-auto text-[10px] border-primary/40 text-primary">
          ADMIN
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: '用户总数', value: stats.users, icon: <Users className="h-4 w-4" />, color: 'text-[hsl(200,70%,55%)]' },
          { label: '问询会话', value: stats.sessions, icon: <FlaskConical className="h-4 w-4" />, color: 'text-primary' },
          { label: '洞见报告', value: stats.reports, icon: <FileText className="h-4 w-4" />, color: 'text-accent' },
          { label: '匹配记录', value: stats.matches, icon: <GitMerge className="h-4 w-4" />, color: 'text-[hsl(45,90%,55%)]' },
          { label: '今日曝光', value: stats.todayExposures, icon: <Eye className="h-4 w-4" />, color: 'text-[hsl(280,60%,60%)]' },
        ].map((s) => (
          <Card key={s.label} className="ariadne-card border-0">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-muted-foreground text-[10px] uppercase tracking-widest">{s.label}</span>
                <span className={s.color}>{s.icon}</span>
              </div>
              <span className="text-2xl font-mono font-bold text-foreground">{s.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="config">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="config" className="text-xs">
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            系统配置
          </TabsTrigger>
          <TabsTrigger value="sessions" className="text-xs">
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
            会话回放
            {badCaseIds.size > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-destructive/20 text-[9px] text-destructive font-bold">
                {badCaseIds.size}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="exposure" className="text-xs">
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            曝光日志
          </TabsTrigger>
          <TabsTrigger value="tiers" className="text-xs">
            <Coins className="h-3.5 w-3.5 mr-1.5" />
            权益管理
          </TabsTrigger>
        </TabsList>

        {/* ── System Config Tab ── */}
        <TabsContent value="config" className="mt-4 space-y-4">
          {/* Prompt Version Section */}
          {promptVersionConfigs.length > 0 && (
            <Card className="ariadne-card border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Prompt 版本管理
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PROMPT_VERSION_KEYS.map(key => {
                    const config = promptVersionConfigs.find(c => c.key === key)
                    if (!config) return null
                    const currentVal = configEdits[key] ?? config.value
                    const vNum = parseInt(currentVal, 10)
                    const label = key.replace('PROMPT_VERSION_', '')
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between p-3 rounded-lg bg-card border border-border/60"
                      >
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">{label}</p>
                          <p className="text-xl font-mono font-bold text-foreground">
                            v{isNaN(vNum) ? currentVal : vNum}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] border-primary/40 text-primary hover:bg-primary/10"
                          onClick={() => handleIncrementPromptVersion(key)}
                          disabled={savingKey === key}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          更新版本
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Regular Configs */}
          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">系统配置项</CardTitle>
            </CardHeader>
            <CardContent>
              {regularConfigs.length === 0 && promptVersionConfigs.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">暂无配置项</p>
              ) : regularConfigs.length === 0 ? null : (
                <div className="space-y-2">
                  {/* Table header */}
                  <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-widest px-2 pb-1 border-b border-border">
                    <span className="col-span-3">KEY</span>
                    <span className="col-span-4">VALUE</span>
                    <span className="col-span-2">TYPE</span>
                    <span className="col-span-2">DESCRIPTION</span>
                    <span className="col-span-1" />
                  </div>

                  {regularConfigs.map((config) => (
                    <div key={config.key} className="grid grid-cols-12 gap-2 items-center px-2 py-2 rounded-lg hover:bg-muted/20 transition-colors">
                      <span className="col-span-3 text-xs font-mono text-foreground truncate">{config.key}</span>
                      <div className="col-span-4">
                        <Input
                          value={configEdits[config.key] ?? config.value}
                          onChange={(e) => setConfigEdits(prev => ({ ...prev, [config.key]: e.target.value }))}
                          className="h-7 text-xs bg-card border-border font-mono"
                        />
                      </div>
                      <Badge variant="outline" className="col-span-2 text-[9px] w-fit border-border text-muted-foreground">
                        {config.type}
                      </Badge>
                      <span className="col-span-2 text-[10px] text-muted-foreground truncate">
                        {config.description || '—'}
                      </span>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={() => handleSaveConfig(config.key)}
                          disabled={savingKey === config.key || configEdits[config.key] === undefined}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Session Replay Tab ── */}
        <TabsContent value="sessions" className="mt-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-40 h-8 text-xs bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部状态</SelectItem>
                <SelectItem value="IN_PROGRESS">进行中</SelectItem>
                <SelectItem value="COMPLETED">已完成</SelectItem>
                <SelectItem value="PAUSED">已暂停</SelectItem>
                <SelectItem value="GENERATING_REPORT">生成中</SelectItem>
              </SelectContent>
            </Select>

            {/* Bad-case filter */}
            <label className="flex items-center gap-2 cursor-pointer group">
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                  showBadCaseOnly
                    ? 'bg-destructive border-destructive'
                    : 'border-border bg-card group-hover:border-destructive/60'
                }`}
                onClick={() => setShowBadCaseOnly(v => !v)}
              >
                {showBadCaseOnly && (
                  <svg className="h-3 w-3 text-destructive-foreground" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className="text-xs text-muted-foreground select-none">
                仅显示 Bad-case
                <span className="ml-1 text-destructive font-mono">({badCaseIds.size})</span>
              </span>
            </label>

            <span className="text-xs text-muted-foreground ml-auto">{filteredSessions.length} 个会话</span>
          </div>

          <div className="space-y-2">
            {filteredSessions.map((session) => {
              const isExpanded = expandedSession === session.id
              const isBadCase = badCaseIds.has(session.id)
              const statusColors: Record<string, string> = {
                IN_PROGRESS: 'border-[hsl(200,70%,55%)]/40 text-[hsl(200,70%,65%)]',
                COMPLETED: 'border-[hsl(165,55%,48%)]/40 text-[hsl(165,55%,48%)]',
                PAUSED: 'border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,65%)]',
                GENERATING_REPORT: 'border-primary/40 text-primary animate-pulse',
              }

              return (
                <Card key={session.id} className={`ariadne-card border-0 ${isBadCase ? 'ring-1 ring-destructive/30' : ''}`}>
                  <button
                    className="w-full p-4 flex items-center gap-3 text-left"
                    onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-foreground">{session.id.slice(0, 20)}...</span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] h-4 ${statusColors[session.status] ?? 'border-border text-muted-foreground'}`}
                        >
                          {session.status}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-4 border-border text-muted-foreground">
                          {session.currentStage}
                        </Badge>
                        {isBadCase && (
                          <Badge variant="outline" className="text-[9px] h-4 border-destructive/50 text-destructive font-bold tracking-wider">
                            BAD CASE
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {session.turnCount ?? 0} 轮 · {session.messages?.length ?? 0} 条消息
                      </p>
                    </div>
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-2 max-h-80 overflow-y-auto">
                      {Array.isArray(session.messages) && session.messages.filter(m => m.role !== 'system').map((msg, i) => (
                        <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                            msg.role === 'user'
                              ? 'bg-primary/10 border border-primary/20 text-foreground'
                              : 'bg-card border border-border text-muted-foreground'
                          }`}>
                            <p className="text-[9px] opacity-60 mb-0.5 uppercase">{msg.role} · {msg.stage}</p>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}

            {filteredSessions.length === 0 && (
              <div className="py-12 text-center">
                <FlaskConical className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">暂无匹配的会话</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Exposure Logs Tab ── */}
        <TabsContent value="exposure" className="mt-4">
          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[hsl(280,60%,60%)]" />
                  曝光日志
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">今日总曝光</span>
                  <span className="text-sm font-mono font-bold text-[hsl(280,60%,60%)]">{todayTotal}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {sortedLogs.length === 0 ? (
                <div className="py-12 text-center">
                  <Eye className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">暂无曝光记录</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-widest px-3 pb-2 border-b border-border">
                    <span className="col-span-5">USER ID</span>
                    <span className="col-span-4">DATE</span>
                    <span className="col-span-3 text-right">EXPOSURES</span>
                  </div>
                  <div className="max-h-[480px] overflow-y-auto space-y-0.5 pr-1">
                    {sortedLogs.map((log) => {
                      const isToday = log.date === today
                      return (
                        <div
                          key={log.id}
                          className={`grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-md transition-colors ${
                            isToday ? 'bg-[hsl(280,60%,60%)]/5 hover:bg-[hsl(280,60%,60%)]/10' : 'hover:bg-muted/20'
                          }`}
                        >
                          <span className="col-span-5 text-xs font-mono text-foreground truncate">
                            {log.userId?.slice(0, 12) ?? '—'}
                          </span>
                          <div className="col-span-4 flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">{log.date}</span>
                            {isToday && (
                              <Badge variant="outline" className="text-[9px] h-4 border-[hsl(280,60%,60%)]/40 text-[hsl(280,60%,60%)]">
                                TODAY
                              </Badge>
                            )}
                          </div>
                          <span className="col-span-3 text-right text-sm font-mono font-semibold text-foreground">
                            {Number(log.dailyExposureCount)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tier & Token Management Tab ── */}
        <TabsContent value="tiers" className="mt-4">
          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                权益管理
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">{userProfiles.length} 用户</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {userProfiles.length === 0 ? (
                <div className="py-12 text-center">
                  <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">暂无用户</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-widest px-3 pb-2 border-b border-border">
                    <span className="col-span-3">USER ID</span>
                    <span className="col-span-2">TIER</span>
                    <span className="col-span-2">TOKENS</span>
                    <span className="col-span-2">ADMIN</span>
                    <span className="col-span-3">ACTIONS</span>
                  </div>
                  <div className="max-h-[520px] overflow-y-auto space-y-0.5 pr-1">
                    {userProfiles.map((prof) => {
                      const isAdmin = Boolean(prof.isAdmin)
                      const tier = prof.tier as UserTier
                      const isSaving = savingProfile === prof.id
                      const tokenInputOpen = showTokenInput === prof.id

                      return (
                        <div key={prof.id} className="space-y-1.5">
                          <div className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 rounded-md hover:bg-muted/20 transition-colors">
                            {/* User ID */}
                            <span className="col-span-3 text-xs font-mono text-foreground truncate" title={prof.userId}>
                              {prof.userId?.slice(0, 12) ?? prof.id.slice(0, 12)}
                            </span>

                            {/* Tier */}
                            <div className="col-span-2">
                              <Select
                                value={tier}
                                onValueChange={(v) => handleChangeTier(prof.id, v as UserTier)}
                                disabled={isSaving}
                              >
                                <SelectTrigger className="h-6 text-[10px] bg-card border-border px-2 w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Free">Free</SelectItem>
                                  <SelectItem value="Ad-Reward">Ad-Reward</SelectItem>
                                  <SelectItem value="Premium">Premium</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Token Balance */}
                            <div className="col-span-2 flex items-center gap-1">
                              <Coins className="h-3 w-3 text-[hsl(45,90%,55%)] shrink-0" />
                              <span className="text-xs font-mono text-foreground">{Number(prof.tokenBalance)}</span>
                            </div>

                            {/* Admin toggle */}
                            <div className="col-span-2">
                              <button
                                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-colors ${
                                  isAdmin
                                    ? 'bg-primary/10 border-primary/40 text-primary'
                                    : 'bg-card border-border text-muted-foreground hover:border-primary/40'
                                }`}
                                onClick={() => handleToggleAdmin(prof.id, isAdmin)}
                                disabled={isSaving}
                              >
                                <ShieldCheck className="h-3 w-3" />
                                {isAdmin ? '是' : '否'}
                              </button>
                            </div>

                            {/* Actions */}
                            <div className="col-span-3 flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,65%)] hover:bg-[hsl(45,90%,55%)]/10 px-2"
                                onClick={() => setShowTokenInput(tokenInputOpen ? null : prof.id)}
                                disabled={isSaving}
                              >
                                <Coins className="h-3 w-3 mr-1" />
                                充值
                              </Button>
                            </div>
                          </div>

                          {/* Inline token input */}
                          {tokenInputOpen && (
                            <div className="mx-3 mb-2 flex items-center gap-2 p-2.5 rounded-lg bg-card border border-border/60">
                              <Coins className="h-3.5 w-3.5 text-[hsl(45,90%,55%)] shrink-0" />
                              <Input
                                type="number"
                                min="1"
                                placeholder="充值数量"
                                value={addTokenInputs[prof.id] ?? ''}
                                onChange={(e) => setAddTokenInputs(prev => ({ ...prev, [prof.id]: e.target.value }))}
                                className="h-7 text-xs bg-background border-border font-mono w-32"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddTokens(prof.id)}
                              />
                              <Button
                                size="sm"
                                className="h-7 text-[10px] bg-primary text-primary-foreground hover:bg-primary/90"
                                onClick={() => handleAddTokens(prof.id)}
                                disabled={isSaving}
                              >
                                确认充值
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] text-muted-foreground"
                                onClick={() => setShowTokenInput(null)}
                              >
                                取消
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
