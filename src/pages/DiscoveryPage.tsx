import { useEffect, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  Badge,
  Skeleton,
  Button,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  toast,
  EmptyState,
} from '@blinkdotnew/ui'
import { Radar as RadarIcon, Users, ArrowUpDown, Globe, Zap, AlertTriangle, X, Flame } from 'lucide-react'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useUserProfile'
import { blink } from '../blink/client'

const MATCH_FN = 'https://x4ygiav9--ariadne-match.functions.blink.new'

type SortMode = 'score' | 'newest' | 'consistency'

interface DiscoveryResult {
  reportId: string
  anonymousId: string
  resonanceScore: number
  featureVector: Record<string, number>
  consistencyScore: number
  overlapDimensions: string[]
  isLowFidelity: boolean
}

interface DeepMatchResult {
  resonanceScore: number
  resonancePoints: string[]
  tensionZones: Array<{ title: string; description: string; severity: number }>
  powerDynamics: string
  growthPotential: string
  criticalWarning: string | null
  icebreakers: string[]
  summary: string
}

const radarDims = ['安全感', '权力', '边界', '冲突', '情感']

function miniRadarData(v: Record<string, number>) {
  const keys = ['v1Security', 'v2Power', 'v3Boundary', 'v4Conflict', 'v5Emotion']
  return radarDims.map((s, i) => ({ subject: s, value: Math.max(0, Math.min(100, (v[keys[i]] ?? 0.5) * 100)) }))
}

// Deep Match SSE modal
function DeepMatchModal({
  card,
  onClose,
  userId,
}: {
  card: DiscoveryResult
  onClose: () => void
  userId: string
}) {
  const [streaming, setStreaming] = useState(false)
  const [chunks, setChunks] = useState('')
  const [result, setResult] = useState<DeepMatchResult | null>(null)
  const [serverMatchId, setServerMatchId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const startMatch = async () => {
    setStreaming(true)
    setChunks('')
    setError('')
    try {
      const token = await blink.auth.getValidToken()
      const resp = await fetch(MATCH_FN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'deep_match',
          userId,
          targetReportId: card.reportId,
        }),
      })

      if (!resp.ok) {
        const data = await resp.json()
        if (resp.status === 402) {
          setError('Token 余额不足，无法执行深度推演（需 50 Token）')
        } else {
          setError(data.error || '推演失败')
        }
        setStreaming(false)
        return
      }

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let accum = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'chunk') {
                accum += data.content
                setChunks(accum)
              }
              if (data.type === 'done' && data.match) {
                setResult(data.match as DeepMatchResult)
                if (data.matchId) setServerMatchId(data.matchId as string)
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setError('网络异常，请重试')
    } finally {
      setStreaming(false)
    }
  }

  const handleConnect = async () => {
    try {
      // Use the server-created matchId from deep_match SSE response to avoid duplicates
      const matchId = serverMatchId ?? `match_${Date.now()}`

      // Only create match record if server didn't already persist one
      if (!serverMatchId) {
        await blink.db.matchRecords.create({
          id: matchId,
          userIdA: userId,
          userIdB: card.reportId,
          resonanceScore: String(card.resonanceScore),
          matchAnalysis: JSON.stringify(result || {}),
          status: 'complete',
          createdAt: new Date().toISOString(),
        })
      }

      const threadId = `thread_${Date.now()}`
      await blink.db.socialThreads.create({
        id: threadId,
        userIdA: userId,
        userIdB: card.anonymousId,
        matchId,
        unlockStage: '0',
        icebreakers: JSON.stringify(result?.icebreakers ?? []),
        tensionReport: JSON.stringify(result ?? {}),
        messages: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      toast.success('连接已建立')
      navigate({ to: '/thread/$threadId', params: { threadId } })
    } catch {
      toast.error('建立连接失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="ariadne-card w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4 p-6 relative">
        <button
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Users className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="font-mono font-bold text-foreground">#{card.anonymousId}</p>
            <p className="text-xs text-muted-foreground">共鸣度 {Math.round(card.resonanceScore * 100)}%</p>
          </div>
        </div>

        {!streaming && !result && (
          <div className="space-y-4">
            <div className="ariadne-card p-4 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">共鸣维度</p>
              <div className="flex flex-wrap gap-1.5">
                {card.overlapDimensions.map((d) => (
                  <Badge key={d} variant="outline" className="text-[10px] border-primary/30 text-primary">{d}</Badge>
                ))}
                {card.overlapDimensions.length === 0 && (
                  <span className="text-xs text-muted-foreground">暂无明显共鸣维度</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg p-3">
              <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
              深度张力推演将消耗 50 Token，生成双人关系报告与破冰建议
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <Button className="w-full glow-primary" onClick={startMatch}>
              <Flame className="h-4 w-4 mr-2" />
              开始深度推演
            </Button>
          </div>
        )}

        {streaming && !result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-primary">
              <span className="animate-pulse">●</span>
              Ariadne 正在推演中...
            </div>
            <div className="bg-muted/30 rounded-lg p-4 text-xs text-muted-foreground font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
              {chunks || '分析双人动力学画像...'}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4 animate-fade-in">
            {/* Summary */}
            <div className="ariadne-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">推演摘要</p>
              <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
            </div>

            {/* Resonance Points */}
            {result.resonancePoints?.length > 0 && (
              <div className="ariadne-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">核心共鸣点</p>
                <ul className="space-y-1.5">
                  {result.resonancePoints.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                      <span className="text-primary mt-1">›</span>{pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tension Zones */}
            {result.tensionZones?.length > 0 && (
              <div className="ariadne-card p-4 border-[hsl(45,90%,55%)]/30">
                <p className="text-xs text-[hsl(45,90%,65%)] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Flame className="h-3 w-3" /> 火药桶预警
                </p>
                <div className="space-y-3">
                  {result.tensionZones.map((z, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{z.title}</span>
                        <Badge variant="outline" className={`text-[9px] ${z.severity > 0.7 ? 'border-destructive/40 text-destructive' : 'border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,65%)]'}`}>
                          {z.severity > 0.7 ? '高风险' : '中风险'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{z.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Critical Warning */}
            {result.criticalWarning && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {result.criticalWarning}
              </div>
            )}

            <Button className="w-full glow-primary" onClick={handleConnect}>
              建立连接 · 进入 The Thread
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DiscoveryPage() {
  const { user } = useAuth()
  const { profile } = useUserProfile(user?.id ?? null)
  const navigate = useNavigate()

  const [results, setResults] = useState<DiscoveryResult[]>([])
  const [hasReport, setHasReport] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('score')
  const [selectedCard, setSelectedCard] = useState<DiscoveryResult | null>(null)
  const [myExposure, setMyExposure] = useState(0)
  const calledRef = useRef(false)

  useEffect(() => {
    if (!user?.id || calledRef.current) return
    calledRef.current = true

    const load = async () => {
      setIsLoading(true)
      try {
        // Check if user has a report
        const myReports = await blink.db.insightReports.list({
          where: { userId: user.id },
          limit: 1,
        })
        setHasReport(myReports.length > 0)

        if (myReports.length === 0) {
          setIsLoading(false)
          return
        }

        // Get exposure for current user today
        const today = new Date().toISOString().slice(0, 10)
        const expLogs = await blink.db.exposureLogs.list({
          where: { userId: user.id, date: today },
          limit: 1,
        })
        if (expLogs.length > 0) {
          setMyExposure(Number((expLogs[0] as Record<string, unknown>).dailyExposureCount) || 0)
        }

        // Call discover API
        const token = await blink.auth.getValidToken()
        const resp = await fetch(MATCH_FN, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: 'discover', userId: user.id }),
        })

        if (resp.ok) {
          const data = await resp.json()
          setResults((data.results as DiscoveryResult[]) || [])
        } else if (resp.status === 404) {
          // No public report yet — need to make report public
          setResults([])
        } else {
          // Fallback to local DB query
          const publicRaw = await blink.db.insightReports.list({
            where: { isPublic: '1' },
            orderBy: { createdAt: 'desc' },
            limit: 30,
          })
          const others = (publicRaw as Record<string, unknown>[]).filter(r => r.userId !== user.id)
          const fallback: DiscoveryResult[] = others.map(r => ({
            reportId: r.id as string,
            anonymousId: `Anon_${(r.id as string).slice(-6)}`,
            resonanceScore: 0.6,
            featureVector: {},
            consistencyScore: Number(r.consistencyScore) || 0,
            overlapDimensions: [],
            isLowFidelity: false,
          }))
          setResults(fallback)
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [user?.id])

  const sortedResults = [...results].sort((a, b) => {
    if (sortMode === 'newest') return 0 // API returns newest order
    if (sortMode === 'consistency') return b.consistencyScore - a.consistencyScore
    return b.resonanceScore - a.resonanceScore
  })

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 animate-fade-in">
      {selectedCard && user?.id && (
        <DeepMatchModal
          card={selectedCard}
          userId={user.id}
          onClose={() => setSelectedCard(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: 'var(--font-serif)' }}>
            共鸣发现
          </h1>
          <p className="text-muted-foreground text-sm mt-1">探索与你心智共鸣的灵魂</p>
        </div>

        <div className="flex items-center gap-2">
          {!profile?.matchingEnabled && (
            <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">
              匹配雷达已关闭
            </Badge>
          )}
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
            <SelectTrigger className="w-36 h-8 text-xs bg-card border-border">
              <ArrowUpDown className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">共鸣度排序</SelectItem>
              <SelectItem value="newest">最新发布</SelectItem>
              <SelectItem value="consistency">自洽度排序</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* My exposure status */}
      {myExposure > 0 && (
        <div className="ariadne-card p-3 flex items-center gap-2 text-xs text-muted-foreground border-border/50">
          <RadarIcon className="h-3.5 w-3.5 text-primary shrink-0" />
          今日曝光次数：{myExposure} · 衰减系数 {Math.max(0, 1 - myExposure * 0.05).toFixed(2)}
        </div>
      )}

      {/* No report prompt */}
      {hasReport === false && !isLoading && (
        <div className="ariadne-card p-4 flex items-center gap-3 border-primary/20">
          <Zap className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm text-muted-foreground">
            完成问询并生成报告后，才能与他人进行共鸣匹配
          </p>
          <Button size="sm" className="ml-auto shrink-0" onClick={() => navigate({ to: '/lab' })}>
            开始问询
          </Button>
        </div>
      )}

      {/* No public report hint */}
      {hasReport === true && results.length === 0 && !isLoading && (
        <div className="ariadne-card p-4 flex items-center gap-3 border-primary/20">
          <Globe className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm text-muted-foreground">
            你的报告尚未公开。前往洞见报告页面开启公开，加入匹配池
          </p>
          <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={() => navigate({ to: '/insight' })}>
            查看报告
          </Button>
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      ) : sortedResults.length === 0 && hasReport !== false ? (
        <EmptyState
          icon={<RadarIcon />}
          title="暂无公开档案"
          description="还没有其他用户公开他们的心智图谱报告"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedResults.map((card) => {
            const pct = Math.round(card.resonanceScore * 100)
            const radarData = miniRadarData(card.featureVector)
            const scoreColor = pct >= 70 ? 'text-primary' : pct >= 50 ? 'text-[hsl(45,90%,55%)]' : 'text-muted-foreground'

            return (
              <Card key={card.reportId} className="ariadne-card border-0 flex flex-col">
                <CardContent className="p-5 flex flex-col gap-4 flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                        <Users className="h-4 w-4 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm font-mono font-semibold text-foreground">#{card.anonymousId}</p>
                        <div className="flex items-center gap-1">
                          <Globe className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">公开档案</span>
                          {card.isLowFidelity && (
                            <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-[hsl(45,90%,55%)]/30 text-[hsl(45,90%,65%)]">
                              低信度
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">共鸣度</p>
                      <p className={`text-lg font-mono font-bold ${scoreColor}`}>{pct}%</p>
                    </div>
                  </div>

                  {/* Mini radar */}
                  <div className="w-full h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="hsl(240 10% 20%)" />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 8, fill: 'hsl(240 8% 45%)' }} />
                        <Radar
                          dataKey="value"
                          stroke="hsl(265 60% 65%)"
                          fill="hsl(265 60% 65%)"
                          fillOpacity={0.15}
                          strokeWidth={1}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Overlap dimensions */}
                  {card.overlapDimensions.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {card.overlapDimensions.map((d) => (
                        <Badge key={d} variant="outline" className="text-[9px] border-primary/20 text-primary/70">{d}</Badge>
                      ))}
                    </div>
                  )}

                  {/* Score bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>共鸣度</span><span>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: 'var(--gradient-primary)' }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>自洽度 <span className="font-mono">{Math.round(card.consistencyScore * 100)}%</span></span>
                  </div>

                  <Button
                    size="sm"
                    className="w-full mt-auto"
                    variant={pct >= 70 ? 'default' : 'outline'}
                    onClick={() => setSelectedCard(card)}
                  >
                    <Flame className="h-3.5 w-3.5 mr-1.5" />
                    深度推演
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
