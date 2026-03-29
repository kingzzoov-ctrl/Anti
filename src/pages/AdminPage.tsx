import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input, Skeleton, Tabs, TabsList, TabsTrigger, TabsContent, Select, SelectTrigger, SelectContent, SelectItem, SelectValue, toast } from '../components/ui'
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
  AlertTriangle,
  MessageSquareWarning,
  Network,
  RotateCcw,
  Download,
  Loader2,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useUserProfile'
import { activateStrategyAsset, fetchAllProfiles, fetchExposureLogs, fetchNotifications, fetchRuntimeConfigs, fetchRuntimeStats, fetchSessions, fetchStrategyAssets, fetchThreads, replayNotification, updateProfile, updateRuntimeConfig } from '../lib/ariadneApi'
import { buildSessionReplayMarkdown } from '../lib/governanceExport'
import { getRuntimeFunctionEnvName, RUNTIME_CONFIG_KEYS } from '../lib/runtimeConfig'
import type { NotificationEvent, SystemConfig, InterviewSession, SocialThread, StrategyAsset } from '../types'

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

interface NotificationInboxItem {
  id: string
  kind: string
  channel: string
  title: string
  body: string
  status: string
  createdAt: string
}

type NotificationStatusFilter = 'ALL' | 'queued' | 'running' | 'delivered' | 'skipped' | 'failed'

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
  const [threads, setThreads] = useState<SocialThread[]>([])
  const [strategyAssets, setStrategyAssets] = useState<StrategyAsset[]>([])
  const [activatingAssetKey, setActivatingAssetKey] = useState<string | null>(null)
  const [rollbackingSessionId, setRollbackingSessionId] = useState<string | null>(null)
  const [notificationEvents, setNotificationEvents] = useState<NotificationEvent[]>([])
  const [notificationStatusFilter, setNotificationStatusFilter] = useState<NotificationStatusFilter>('ALL')
  const [notificationSourceFilter, setNotificationSourceFilter] = useState<string>('ALL')
  const [replayingNotificationId, setReplayingNotificationId] = useState<string | null>(null)

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
        const [rawConfigs, rawSessions, rawProfiles, rawExposureLogs, runtimeStats, rawThreads, rawStrategyAssets, rawNotificationEvents] = await Promise.all([
          fetchRuntimeConfigs(),
          fetchSessions(),
          fetchAllProfiles(),
          fetchExposureLogs(),
          fetchRuntimeStats(),
          fetchThreads(),
          fetchStrategyAssets(),
          fetchNotifications({ limit: 120 }),
        ])

        setConfigs(rawConfigs as SystemConfig[])
        setSessions(rawSessions.map(s => ({
          ...s,
          messages: typeof (s as unknown as { messages: string | unknown[] }).messages === 'string'
            ? JSON.parse((s as unknown as { messages: string }).messages || '[]')
            : ((s as unknown as { messages: unknown[] }).messages ?? []),
        })) as unknown as InterviewSession[])

        const logsTyped = rawExposureLogs as unknown as ExposureLog[]
        setExposureLogs(logsTyped)
        setUserProfiles(rawProfiles as unknown as RawProfile[])
        setStats(runtimeStats)
        setThreads(rawThreads)
        setStrategyAssets(rawStrategyAssets)
        setNotificationEvents(rawNotificationEvents)
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
      const rawProfiles = await fetchAllProfiles()
      setUserProfiles(rawProfiles as unknown as RawProfile[])
      setStats(prev => ({ ...prev, users: rawProfiles.length }))
    } catch {
      // ignore
    }
  }

  const handleActivateStrategyAsset = async (assetKey: string, version: string) => {
    setActivatingAssetKey(`${assetKey}:${version}`)
    try {
      const updated = await activateStrategyAsset(assetKey, version, 'admin-console-manual-switch', user?.id)
      if (updated) {
        setStrategyAssets(prev => prev.map(asset => {
          if (asset.assetKey !== assetKey) return asset
          if (asset.version === version) return { ...asset, ...updated, isActive: true }
          return { ...asset, isActive: false }
        }))
        toast.success(`已切换 ${assetKey} 到 ${version}`)
      }
    } catch {
      toast.error('切换策略资产失败')
    } finally {
      setActivatingAssetKey(null)
    }
  }

  const handleSaveConfig = async (key: string) => {
    const newVal = configEdits[key]
    if (newVal === undefined) return
    setSavingKey(key)
    try {
      const updated = await updateRuntimeConfig(key, newVal)
      setConfigs(prev => prev.map(c => c.key === key ? { ...c, value: updated?.value ?? newVal } : c))
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
      const updated = await updateRuntimeConfig(key, nextVal)
      setConfigs(prev => prev.map(c => c.key === key ? { ...c, value: updated?.value ?? nextVal } : c))
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
      await updateProfile(profileId, {
        tokenBalance: newBalance,
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
      await updateProfile(profileId, { tier })
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
      await updateProfile(profileId, { isAdmin: !current })
      toast.success(current ? '已取消管理员权限' : '已授予管理员权限')
      await reloadProfiles()
    } catch {
      toast.error('操作失败')
    } finally {
      setSavingProfile(null)
    }
  }

  // Bad-case: 优先使用正式 badCaseFlags，其次回退旧阈值规则
  const badCaseIds = new Set(
    sessions.filter(s => (s.badCaseFlags?.length ?? 0) > 0 || (s.status === 'COMPLETED' && (s.turnCount ?? 0) < 8)).map(s => s.id)
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
  const latestInbox = userProfiles
    .flatMap(profile => {
      const inbox = Array.isArray((profile as unknown as { notificationChannels?: { inbox?: NotificationInboxItem[] } }).notificationChannels?.inbox)
        ? ((profile as unknown as { notificationChannels?: { inbox?: NotificationInboxItem[] } }).notificationChannels?.inbox ?? [])
        : []
      return inbox.map(item => ({ ...item, userId: profile.userId }))
    })
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .slice(0, 12)
  const badCaseSessions = sessions.filter(session => badCaseIds.has(session.id))
  const notificationSourceKinds = Array.from(new Set(notificationEvents.map(item => item.sourceKind).filter(Boolean) as string[]))
  const filteredNotificationEvents = notificationEvents.filter(item => {
    const statusOk = notificationStatusFilter === 'ALL' || item.status === notificationStatusFilter
    const sourceOk = notificationSourceFilter === 'ALL' || item.sourceKind === notificationSourceFilter
    return statusOk && sourceOk
  })
  const deadLetterNotifications = notificationEvents.filter(item => Boolean(item.deadLetteredAt || item.status === 'failed'))
  const deliveredNotifications = notificationEvents.filter(item => item.status === 'delivered').length
  const queuedNotifications = notificationEvents.filter(item => item.status === 'queued' || item.status === 'running').length

  const handleExportSessionReplay = (session: InterviewSession) => {
    const content = buildSessionReplayMarkdown(session)
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Ariadne_Session_${session.id.slice(-6)}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('已导出回放文件')
  }

  const handleRollbackBadCase = async (session: InterviewSession) => {
    setRollbackingSessionId(session.id)
    try {
      const safeMessages = (session.messages ?? []).filter(message => message.role !== 'system').slice(0, Math.max(0, (session.messages?.length ?? 0) - 2))
      await updateRuntimeConfig('LAST_BAD_CASE_REPLAY_SESSION', session.id)
      await updateRuntimeConfig('LAST_BAD_CASE_REPLAY_AT', new Date().toISOString())
      await updateRuntimeConfig('LAST_BAD_CASE_REPLAY_FLAG', (session.badCaseFlags ?? []).join('|') || 'manual_review')
      toast.success('已登记 bad-case 回滚锚点', {
        description: `建议基于 ${safeMessages.length} 条消息重放该会话`,
      })
    } catch {
      toast.error('回滚登记失败')
    } finally {
      setRollbackingSessionId(null)
    }
  }

  const reloadNotifications = async () => {
    try {
      const items = await fetchNotifications({ limit: 120 })
      setNotificationEvents(items)
    } catch {
      toast.error('刷新通知队列失败')
    }
  }

  const handleReplayNotification = async (eventId: string) => {
    setReplayingNotificationId(eventId)
    try {
      await replayNotification(eventId)
      toast.success('通知已重新入队')
      await reloadNotifications()
    } catch {
      toast.error('通知重放失败')
    } finally {
      setReplayingNotificationId(null)
    }
  }

  const getNotificationStatusBadgeClass = (status: string) => {
    if (status === 'delivered') return 'border-primary/40 text-primary'
    if (status === 'queued' || status === 'running') return 'border-[hsl(200,70%,55%)]/40 text-[hsl(200,70%,65%)]'
    if (status === 'failed') return 'border-destructive/40 text-destructive'
    if (status === 'skipped') return 'border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,65%)]'
    return 'border-border text-muted-foreground'
  }

  const formatNotificationTime = (value?: string | null) => {
    if (!value) return '—'
    return value.replace('T', ' ').replace('Z', '')
  }

  const promptVersionConfigs = configs.filter(c => PROMPT_VERSION_KEYS.includes(c.key))
  const regularConfigs = configs.filter(c => !PROMPT_VERSION_KEYS.includes(c.key))
  const runtimeEngineConfigs = configs.filter(c => [
    'LLM_API_ENDPOINT',
    'LLM_MODEL_INTERVIEW',
    'LLM_MODEL_MATCH',
    'VECTOR_DIMENSION',
    'MATCH_DECAY_FACTOR',
    'MATCH_RESONANCE_THRESHOLD',
    'CONSISTENCY_MIN_THRESHOLD',
  ].includes(c.key))
  const promptAssetOverview = [
    {
      key: 'INTERVIEW',
      title: '问询 Prompt 资产',
      summary: '负责阶段式问询、矛盾追踪、状态标记与收敛推进。',
      scope: ['DIVERGENT / PRESS / CONVERGE', '矛盾标记', '维度覆盖'],
    },
    {
      key: 'REPORT',
      title: '报告 Prompt 资产',
      summary: '负责章节化报告、legacy 兼容段落、七维向量与质量标志。',
      scope: ['基座章节结构', '输出 schema', '质量提醒'],
    },
    {
      key: 'MATCH',
      title: '匹配 Prompt 资产',
      summary: '负责双人关系推演、张力区、关系形态与破冰内容。',
      scope: ['关系定位兼容', '火药桶', '破冰问题'],
    },
  ]

  const runtimeRouteOverview = [
    {
      key: RUNTIME_CONFIG_KEYS.interview,
      title: '问询函数路由',
      envName: getRuntimeFunctionEnvName('interview'),
      description: 'Lab 问询流、会话推进、报告生成统一走该运行时路由。',
    },
    {
      key: RUNTIME_CONFIG_KEYS.match,
      title: '匹配函数路由',
      envName: getRuntimeFunctionEnvName('match'),
      description: 'Discovery 深度推演、Thread 破冰建议与张力报告统一走该路由。',
    },
  ]

  const tierColorMap: Record<UserTier, string> = {
    Free: 'border-border text-muted-foreground',
    'Ad-Reward': 'border-[hsl(45,90%,55%)]/50 text-[hsl(45,90%,65%)]',
    Premium: 'border-primary/50 text-primary',
  }
  const blockedContactThreads = threads.filter(thread => !thread.contactExchangeStatus?.allowed)
  const severeThreads = threads.filter(thread => (thread.contactExchangeStatus?.severeZoneCount ?? 0) > 0 || Boolean(thread.tensionHandbook?.criticalWarning))
  const strategyAssetGroups = strategyAssets.reduce<Record<string, StrategyAsset[]>>((acc, asset) => {
    acc[asset.assetKey] ??= []
    acc[asset.assetKey].push(asset)
    return acc
  }, {})

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
          <TabsTrigger value="notifications" className="text-xs">
            <Network className="h-3.5 w-3.5 mr-1.5" />
            通知中心
          </TabsTrigger>
          <TabsTrigger value="governance" className="text-xs">
            <Network className="h-3.5 w-3.5 mr-1.5" />
            治理闭环
          </TabsTrigger>
        </TabsList>

        {/* ── System Config Tab ── */}
        <TabsContent value="config" className="mt-4 space-y-4">
          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Prompt 资产总览
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {promptAssetOverview.map((asset) => {
                  const versionConfig = promptVersionConfigs.find(c => c.key === `PROMPT_VERSION_${asset.key}`)
                  return (
                    <div key={asset.key} className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{asset.title}</p>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{asset.summary}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary shrink-0">
                          {versionConfig ? `v${versionConfig.value}` : '未设版本'}
                        </Badge>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">当前治理范围</p>
                        <div className="flex flex-wrap gap-1.5">
                          {asset.scope.map(item => (
                            <Badge key={item} variant="outline" className="text-[10px] border-border text-muted-foreground">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                报告章节治理基线
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  '你的基本画像',
                  '你在找什么关系',
                  '你以为你想要的',
                  '你真正需要的',
                  '你的认知密码',
                  '偏好与需求对照',
                  '你的关系模式',
                  '择偶方向建议',
                  '遇到对的人的概率',
                  '写在最后',
                ].map((chapter, index) => (
                  <div key={chapter} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-mono text-primary shrink-0">
                      {index + 1}
                    </div>
                    <div>
                      <p className="text-sm text-foreground">{chapter}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">纳入统一章节化报告 schema</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" />
                运行时函数路由治理
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {runtimeRouteOverview.map((route) => {
                  const config = configs.find((item) => item.key === route.key)
                  return (
                    <div key={route.key} className="rounded-lg border border-border/60 bg-card p-4 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">{route.title}</p>
                        <Badge variant="outline" className={`text-[10px] ${config?.value ? 'border-primary/30 text-primary' : 'border-destructive/30 text-destructive'}`}>
                          {config?.value ? '已配置' : '待配置'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{route.description}</p>
                      <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">SystemConfig Key</p>
                        <p className="text-xs font-mono text-foreground mt-1">{route.key}</p>
                      </div>
                      <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">环境变量回退</p>
                        <p className="text-xs font-mono text-foreground mt-1">{route.envName}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {runtimeEngineConfigs.length > 0 && (
            <Card className="ariadne-card border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  运行时模型 / 向量热切换
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {runtimeEngineConfigs.map((config) => (
                    <div key={config.key} className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{config.key}</p>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {config.description || '运行时热切换配置项'}
                          </p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] ${config.source === 'system-config' ? 'border-primary/30 text-primary' : 'border-border text-muted-foreground'}`}>
                          {config.source === 'system-config' ? '已覆写' : '环境默认'}
                        </Badge>
                      </div>
                      <Input
                        value={configEdits[config.key] ?? config.value}
                        onChange={(e) => setConfigEdits(prev => ({ ...prev, [config.key]: e.target.value }))}
                        className="h-8 text-xs bg-background border-border font-mono"
                      />
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                          {config.type}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] border-primary/40 text-primary hover:bg-primary/10"
                          onClick={() => handleSaveConfig(config.key)}
                          disabled={savingKey === config.key || configEdits[config.key] === undefined}
                        >
                          <Save className="h-3 w-3 mr-1" />
                          热更新
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {session.readiness !== undefined && (
                          <Badge variant="outline" className={`text-[9px] h-4 ${session.readiness ? 'border-primary/40 text-primary' : 'border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,65%)]'}`}>
                            {session.readiness ? 'READY' : 'NOT_READY'}
                          </Badge>
                        )}
                        {(session.badCaseFlags ?? []).slice(0, 3).map(flag => (
                          <Badge key={flag} variant="outline" className="text-[9px] h-4 border-destructive/40 text-destructive">
                            {flag}
                          </Badge>
                        ))}
                        {session.completionReason && (
                          <Badge variant="outline" className="text-[9px] h-4 border-border text-muted-foreground">
                            {session.completionReason}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-2 max-h-80 overflow-y-auto">
                      {(session.stateContext || session.readiness !== undefined || (session.badCaseFlags?.length ?? 0) > 0) && (
                        <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {session.stateContext?.activeDimensions?.map(item => (
                              <Badge key={item} variant="outline" className="text-[9px] h-4 border-primary/30 text-primary">
                                {item}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            readiness={String(session.readiness ?? session.stateContext?.readiness ?? false)} · offTopic={session.offTopicCount ?? session.stateContext?.offTopicCount ?? 0} · consistency={session.stateContext?.consistencyProxy ?? '—'}
                          </p>
                        </div>
                      )}
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

        <TabsContent value="notifications" className="mt-4">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card className="ariadne-card border-0">
                <CardContent className="p-4 space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">通知事件</p>
                  <p className="text-2xl font-mono font-bold text-foreground">{notificationEvents.length}</p>
                </CardContent>
              </Card>
              <Card className="ariadne-card border-0">
                <CardContent className="p-4 space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">排队处理中</p>
                  <p className="text-2xl font-mono font-bold text-[hsl(200,70%,65%)]">{queuedNotifications}</p>
                </CardContent>
              </Card>
              <Card className="ariadne-card border-0">
                <CardContent className="p-4 space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">已送达</p>
                  <p className="text-2xl font-mono font-bold text-primary">{deliveredNotifications}</p>
                </CardContent>
              </Card>
              <Card className="ariadne-card border-0">
                <CardContent className="p-4 space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">死信 / 失败</p>
                  <p className="text-2xl font-mono font-bold text-destructive">{deadLetterNotifications.length}</p>
                </CardContent>
              </Card>
            </div>

            <Card className="ariadne-card border-0">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Network className="h-4 w-4 text-primary" />
                    通知队列治理
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-[10px] border-primary/40 text-primary hover:bg-primary/10"
                    onClick={reloadNotifications}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    刷新
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={notificationStatusFilter} onValueChange={(v) => setNotificationStatusFilter(v as NotificationStatusFilter)}>
                    <SelectTrigger className="w-40 h-8 text-xs bg-card border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">全部状态</SelectItem>
                      <SelectItem value="queued">queued</SelectItem>
                      <SelectItem value="running">running</SelectItem>
                      <SelectItem value="delivered">delivered</SelectItem>
                      <SelectItem value="skipped">skipped</SelectItem>
                      <SelectItem value="failed">failed</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={notificationSourceFilter} onValueChange={setNotificationSourceFilter}>
                    <SelectTrigger className="w-40 h-8 text-xs bg-card border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">全部来源</SelectItem>
                      {notificationSourceKinds.map(source => (
                        <SelectItem key={source} value={source}>{source}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <span className="text-xs text-muted-foreground ml-auto">{filteredNotificationEvents.length} 条事件</span>
                </div>

                {filteredNotificationEvents.length === 0 ? (
                  <div className="py-12 text-center">
                    <Network className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">暂无匹配的通知事件</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredNotificationEvents.map(item => {
                      const isDeadLetter = Boolean(item.deadLetteredAt || item.status === 'failed')
                      const canReplay = item.status === 'failed' || item.status === 'skipped' || Boolean(item.deadLetteredAt)
                      return (
                        <div key={item.id} className={`rounded-lg border bg-card p-3 space-y-2 ${isDeadLetter ? 'border-destructive/40' : 'border-border/60'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs font-medium text-foreground">{item.title || item.kind}</p>
                                <Badge variant="outline" className={`text-[9px] h-4 ${getNotificationStatusBadgeClass(item.status)}`}>
                                  {item.status}
                                </Badge>
                                <Badge variant="outline" className="text-[9px] h-4 border-border text-muted-foreground">
                                  {item.channel}
                                </Badge>
                                <Badge variant="outline" className="text-[9px] h-4 border-border text-muted-foreground">
                                  {item.kind}
                                </Badge>
                                {isDeadLetter && (
                                  <Badge variant="outline" className="text-[9px] h-4 border-destructive/40 text-destructive">
                                    dead-letter
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-1 break-all">
                                {item.userId} · {item.sourceKind ?? 'unknown-source'} · retry {item.retryCount}/{item.maxRetries}
                              </p>
                            </div>
                            {canReplay && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10"
                                onClick={() => handleReplayNotification(item.id)}
                                disabled={replayingNotificationId === item.id}
                              >
                                {replayingNotificationId === item.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                                重放
                              </Button>
                            )}
                          </div>

                          <p className="text-xs text-muted-foreground">{item.body}</p>

                          {item.lastError && (
                            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-[11px] text-destructive break-all">
                              {item.lastError}
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[10px] text-muted-foreground">
                            <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                              <p className="uppercase tracking-widest">created</p>
                              <p className="mt-1 text-foreground">{formatNotificationTime(item.createdAt)}</p>
                            </div>
                            <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                              <p className="uppercase tracking-widest">scheduled</p>
                              <p className="mt-1 text-foreground">{formatNotificationTime(item.scheduledAt)}</p>
                            </div>
                            <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                              <p className="uppercase tracking-widest">delivered</p>
                              <p className="mt-1 text-foreground">{formatNotificationTime(item.deliveredAt)}</p>
                            </div>
                            <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                              <p className="uppercase tracking-widest">idempotency</p>
                              <p className="mt-1 text-foreground break-all">{item.idempotencyKey ?? '—'}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="ariadne-card border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquareWarning className="h-4 w-4 text-[hsl(45,90%,65%)]" />
                  用户 Inbox 快照
                </CardTitle>
              </CardHeader>
              <CardContent>
                {latestInbox.length === 0 ? (
                  <div className="py-10 text-center">
                    <Network className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">暂无 inbox 快照</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {latestInbox.map(item => (
                      <div key={item.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-foreground">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{item.userId} · {item.channel} · {item.kind}</p>
                          </div>
                          <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                            {item.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.body}</p>
                        <p className="text-[10px] text-muted-foreground/70">{item.createdAt}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="governance" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="ariadne-card border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquareWarning className="h-4 w-4 text-destructive" />
                  线程风险概览
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3">
                  <span className="text-xs text-muted-foreground">线程总数</span>
                  <span className="text-lg font-mono text-foreground">{threads.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3">
                  <span className="text-xs text-muted-foreground">联系方式被阻塞</span>
                  <span className="text-lg font-mono text-[hsl(45,90%,65%)]">{blockedContactThreads.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3">
                  <span className="text-xs text-muted-foreground">高危线程</span>
                  <span className="text-lg font-mono text-destructive">{severeThreads.length}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="ariadne-card border-0 lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  策略资产激活矩阵
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(strategyAssetGroups).map(([assetKey, items]) => (
                  <div key={assetKey} className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">{assetKey}</p>
                      <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                        {items.length} 个版本
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {items.sort((a, b) => b.version.localeCompare(a.version)).map(asset => (
                        <div key={`${asset.assetKey}:${asset.version}`} className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/20 p-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-foreground">{asset.title || asset.version}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{asset.sourcePath || '未登记 sourcePath'}</p>
                            {(asset.rollbackNote || asset.activatedFromVersion || asset.rollbackOperator) ? (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {asset.activatedFromVersion ? `从 ${asset.activatedFromVersion} 回切` : '首次激活'}
                                {asset.rollbackOperator ? ` · 操作者 ${asset.rollbackOperator}` : ''}
                                {asset.rollbackNote ? ` · ${asset.rollbackNote}` : ''}
                              </p>
                            ) : null}
                          </div>
                          <Badge variant="outline" className={`text-[9px] ${asset.isActive ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}>
                            {asset.version}
                          </Badge>
                          {!asset.isActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] border-primary/40 text-primary hover:bg-primary/10"
                              onClick={() => handleActivateStrategyAsset(asset.assetKey, asset.version)}
                              disabled={activatingAssetKey === `${asset.assetKey}:${asset.version}`}
                            >
                              激活
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-destructive" />
                Bad-case 回滚与复盘
              </CardTitle>
            </CardHeader>
            <CardContent>
              {badCaseSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">当前没有需要回滚登记的 bad-case 会话。</p>
              ) : (
                <div className="space-y-2">
                  {badCaseSessions.slice(0, 10).map(session => (
                    <div key={session.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono text-foreground">{session.id}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {session.currentStage} · {session.turnCount} 轮 · {session.completionReason ?? '未完成'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(session.badCaseFlags ?? []).slice(0, 3).map(flag => (
                            <Badge key={flag} variant="outline" className="text-[9px] h-4 border-destructive/40 text-destructive">
                              {flag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] border-border text-muted-foreground hover:text-foreground"
                          onClick={() => handleExportSessionReplay(session)}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          导出回放
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => handleRollbackBadCase(session)}
                          disabled={rollbackingSessionId === session.id}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          {rollbackingSessionId === session.id ? '登记中...' : '登记回滚'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="ariadne-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[hsl(45,90%,65%)]" />
                联系方式阻塞线程
              </CardTitle>
            </CardHeader>
            <CardContent>
              {blockedContactThreads.length === 0 ? (
                <p className="text-sm text-muted-foreground">当前没有被阻塞的联系方式交换线程。</p>
              ) : (
                <div className="space-y-2">
                  {blockedContactThreads.slice(0, 12).map(thread => (
                    <div key={thread.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono text-foreground">{thread.id}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            stage {thread.unlockState?.currentStage ?? thread.unlockStage} · 消息 {thread.unlockState?.effectiveMessageCount ?? thread.messages.length}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[9px] border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,65%)]">
                          {thread.contactExchangeStatus?.relationshipFitLabel ?? '待评估'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(thread.contactExchangeStatus?.blockers ?? []).slice(0, 4).map(blocker => (
                          <Badge key={blocker} variant="outline" className="text-[9px] border-destructive/30 text-destructive">
                            {blocker}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
