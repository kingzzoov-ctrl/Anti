import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Switch,
  Skeleton,
  Progress,
} from '@blinkdotnew/ui'
import {
  FlaskConical,
  FileText,
  Users,
  ChevronRight,
  Zap,
  Activity,
  TrendingDown,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useUserProfile'
import { blink } from '../blink/client'
import type { InsightReport, InterviewSession } from '../types'

export default function DashboardPage() {
  const { user } = useAuth()
  const { profile, isLoading: profileLoading, toggleMatching } = useUserProfile(user?.id ?? null)
  const navigate = useNavigate()

  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [reports, setReports] = useState<InsightReport[]>([])
  const [matches, setMatches] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)
  const [todayExposureCount, setTodayExposureCount] = useState(0)
  const [decayCoeff, setDecayCoeff] = useState(1)

  useEffect(() => {
    if (!user?.id) return
    const fetchStats = async () => {
      setStatsLoading(true)
      try {
        const today = new Date().toISOString().split('T')[0]
        const [rawSessions, rawReports, rawMatches, exposureRaw] = await Promise.all([
          blink.db.interviewSessions.list({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, limit: 50 }),
          blink.db.insightReports.list({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, limit: 3 }),
          blink.db.matchRecords.list({
            where: { OR: [{ userIdA: user.id }, { userIdB: user.id }] },
            limit: 100,
          }),
          blink.db.exposureLogs.list({
            where: { userId: user.id, date: today },
            limit: 1,
          }),
        ])
        setSessions(rawSessions as unknown as InterviewSession[])
        setReports(rawReports as unknown as InsightReport[])
        setMatches(rawMatches.length)

        const count = exposureRaw.length > 0 ? Number((exposureRaw[0] as any).dailyExposureCount) : 0
        const coeff = Math.max(0, 1 - count * 0.05)
        setTodayExposureCount(count)
        setDecayCoeff(coeff)
      } catch {
        // ignore
      } finally {
        setStatsLoading(false)
      }
    }
    fetchStats()
  }, [user?.id])

  const displayName = profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User'
  const completedSessions = sessions.filter(s => s.status === 'COMPLETED').length
  const lowBalance = (profile?.tokenBalance ?? 0) < 20
  const lowVisibility = decayCoeff < 0.7

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 animate-fade-in">
      {/* Background decorative element */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full opacity-5"
          style={{ background: 'var(--gradient-primary)', filter: 'blur(80px)' }}
        />
        <div
          className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, hsl(265 60% 65%), transparent)', filter: 'blur(60px)' }}
        />
      </div>

      {/* Hero greeting card */}
      <div className="ariadne-card p-8 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{ background: 'var(--gradient-primary)' }}
        />
        <div className="relative z-10">
          <p className="text-muted-foreground text-sm mb-1 tracking-wider">Welcome back</p>
          <h1 className="text-3xl font-bold gradient-text mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
            你好，{displayName}
          </h1>
          <p className="text-muted-foreground text-sm">
            继续你的心智探索之旅
          </p>

          {/* Token balance + Decay coefficient row */}
          <div className="mt-6 flex items-start gap-6 flex-wrap">
            {/* Token balance */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-widest">Token 余额</span>
              {profileLoading ? (
                <Skeleton className="h-10 w-24" />
              ) : (
                <div className={`flex items-end gap-2 ${lowBalance ? 'animate-pulse' : ''}`}>
                  <span
                    className={`text-4xl font-mono font-bold ${lowBalance ? 'text-destructive' : 'text-primary'}`}
                    style={lowBalance ? { boxShadow: 'none', filter: 'drop-shadow(0 0 8px hsl(0 72% 55% / 0.5))' } : {}}
                  >
                    {profile?.tokenBalance ?? 0}
                  </span>
                  {lowBalance && (
                    <Badge variant="destructive" className="mb-1 text-[10px]">
                      余额不足
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px self-stretch bg-border/50 my-1" />

            {/* Decay coefficient */}
            <div className="flex flex-col gap-1 min-w-[140px]">
              <span className="text-xs text-muted-foreground uppercase tracking-widest">曝光冷却系数</span>
              {statsLoading ? (
                <Skeleton className="h-10 w-28" />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-end gap-2">
                    <span
                      className={`text-4xl font-mono font-bold ${
                        lowVisibility ? 'text-amber-500' : 'text-primary'
                      }`}
                    >
                      {(decayCoeff * 100).toFixed(0)}%
                    </span>
                    <span className="text-xs text-muted-foreground mb-1.5">曝光系数</span>
                  </div>
                  {/* Decay bar */}
                  <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        lowVisibility
                          ? 'bg-amber-500'
                          : decayCoeff >= 0.9
                          ? 'bg-primary'
                          : 'bg-primary/70'
                      }`}
                      style={{ width: `${(decayCoeff * 100).toFixed(0)}%` }}
                    />
                  </div>
                  {/* Warning if low visibility */}
                  {lowVisibility && (
                    <div className="flex items-center gap-1 text-amber-500">
                      <TrendingDown className="h-3 w-3 shrink-0" />
                      <span className="text-[11px] font-medium">曝光过多，可见度下降</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Matching toggle — pushed to the right */}
            <div className="ml-auto flex flex-col items-end gap-1 self-start">
              <span className="text-xs text-muted-foreground uppercase tracking-widest">匹配雷达</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {profile?.matchingEnabled ? '开启中' : '已关闭'}
                </span>
                {profileLoading ? (
                  <Skeleton className="h-6 w-11" />
                ) : (
                  <Switch
                    checked={profile?.matchingEnabled ?? false}
                    onCheckedChange={() => toggleMatching()}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tier upgrade CTA — only for Free tier */}
      {profile?.tier === 'Free' && (
        <div className="ariadne-card p-4 flex items-center gap-4 border-accent/20 bg-accent/5">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">解锁 Premium 全部能力</p>
            <p className="text-xs text-muted-foreground mt-0.5">即时触达 · 深度推演 · 专属算力</p>
          </div>
          <Badge variant="outline" className="border-accent/40 text-accent shrink-0">即将推出</Badge>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: '完成问询', value: statsLoading ? null : completedSessions, icon: <FlaskConical className="h-4 w-4" />, color: 'text-primary' },
          { label: '洞见报告', value: statsLoading ? null : reports.length, icon: <FileText className="h-4 w-4" />, color: 'text-accent' },
          { label: '共鸣匹配', value: statsLoading ? null : matches, icon: <Users className="h-4 w-4" />, color: 'text-[hsl(200,70%,55%)]' },
        ].map((stat) => (
          <Card key={stat.label} className="ariadne-card border-0">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-muted-foreground text-xs uppercase tracking-widest">{stat.label}</span>
                <span className={stat.color}>{stat.icon}</span>
              </div>
              {stat.value === null ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <span className="text-3xl font-mono font-bold text-foreground">{stat.value}</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Today's activity quick view */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
        {statsLoading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <>
            <span>今日曝光: {todayExposureCount} 次</span>
            <span>·</span>
            <span>可见度: {(decayCoeff * 100).toFixed(0)}%</span>
            {profile?.matchingEnabled && <span>· 匹配雷达: 运行中</span>}
          </>
        )}
      </div>

      {/* Recent reports */}
      <Card className="ariadne-card border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            最近洞见报告
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {statsLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
          ) : reports.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground text-sm">暂无报告</p>
              <p className="text-muted-foreground text-xs mt-1">完成一次问询后，系统将自动生成你的心智图谱</p>
            </div>
          ) : (
            reports.map((report) => {
              let rawContent: { summary?: string } = {}
              try {
                rawContent = typeof report.rawContent === 'string'
                  ? JSON.parse(report.rawContent)
                  : (report.rawContent ?? {})
              } catch {
                rawContent = {}
              }
              const score = Number(report.consistencyScore) || 0
              return (
                <button
                  key={report.id}
                  className="w-full text-left ariadne-card p-4 flex items-center gap-4 hover:border-primary/40 transition-all"
                  onClick={() => navigate({ to: '/insight/$reportId', params: { reportId: report.id } })}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {report.title || '心智图谱报告'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {rawContent.summary?.slice(0, 60) || '查看你的深度洞见分析'}...
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="w-20">
                      <Progress value={score} className="h-1.5" />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{Math.round(score)}% 自洽</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* CTA */}
      <div className="flex justify-center pb-6">
        <button
          onClick={() => navigate({ to: '/lab' })}
          className="group relative px-10 py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-lg glow-primary transition-all hover:opacity-90 hover:scale-105 active:scale-95 flex items-center gap-3"
        >
          <Zap className="h-5 w-5 group-hover:animate-pulse" />
          进入问询实验室
        </button>
      </div>
    </div>
  )
}
