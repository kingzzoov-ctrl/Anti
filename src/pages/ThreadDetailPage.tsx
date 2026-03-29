import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { Button, Textarea, Badge, Skeleton, Separator, toast, Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui'
import {
  ChevronLeft,
  Send,
  Lock,
  Unlock,
  MessageCircle,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Zap,
  X,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { fetchThreadById, generateIcebreakers, upsertThread } from '../lib/ariadneApi'
import type { SocialThread, ThreadMessage, MatchAnalysisPayload, UnlockMilestone } from '../types'

const POLL_INTERVAL = 3000

const UNLOCK_REQUIREMENTS = [0, 5, 10, 15]

function normalizeMatchAnalysis(input: unknown): MatchAnalysisPayload | null {
  if (!input) return null
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input
    if (!parsed || typeof parsed !== 'object') return null
    const payload = parsed as Partial<MatchAnalysisPayload>
    return {
      resonanceScore: Number(payload.resonanceScore ?? 0),
      resonancePoints: Array.isArray(payload.resonancePoints) ? payload.resonancePoints.map(String) : [],
      tensionZones: Array.isArray(payload.tensionZones)
        ? payload.tensionZones.map((zone) => ({
            title: String(zone.title ?? '未命名张力点'),
            description: String(zone.description ?? ''),
            severity: Number(zone.severity ?? 0),
          }))
        : [],
      powerDynamics: String(payload.powerDynamics ?? ''),
      growthPotential: String(payload.growthPotential ?? ''),
      criticalWarning: payload.criticalWarning ? String(payload.criticalWarning) : null,
      icebreakers: Array.isArray(payload.icebreakers) ? payload.icebreakers.map(String) : [],
      summary: String(payload.summary ?? ''),
      relationshipFit: payload.relationshipFit,
      guidance: Array.isArray(payload.guidance) ? payload.guidance.map(String) : [],
      unlockMilestones: Array.isArray(payload.unlockMilestones) ? payload.unlockMilestones as UnlockMilestone[] : [],
    }
  } catch {
    return null
  }
}

function buildMilestoneState(stage: 0 | 1 | 2 | 3, source: UnlockMilestone[] = []): UnlockMilestone[] {
  const base: UnlockMilestone[] = [
    { stage: 0, label: '匿名试探', requirement: '建立连接后立即可用', unlocked: stage >= 0 },
    { stage: 1, label: '主题交换', requirement: '累计 5 条有效消息', unlocked: stage >= 1 },
    { stage: 2, label: '边界试探', requirement: '累计 10 条有效消息', unlocked: stage >= 2 },
    { stage: 3, label: '深层解锁', requirement: '累计 15 条有效消息', unlocked: stage >= 3 },
  ]

  return base.map((item) => {
    const matched = source.find((s) => s.stage === item.stage)
    return matched ? { ...item, ...matched, unlocked: stage >= item.stage } : item
  })
}

function normalizeThread(thread: SocialThread): SocialThread {
  return {
    ...thread,
    messages: Array.isArray(thread.messages)
      ? thread.messages
      : JSON.parse(String(thread.messages || '[]')),
    icebreakers: Array.isArray(thread.icebreakers)
      ? thread.icebreakers
      : JSON.parse(String(thread.icebreakers || '[]')),
    unlockStage: Number(thread.unlockStage ?? 0) as 0 | 1 | 2 | 3,
    unlockMilestones: Array.isArray(thread.unlockMilestones)
      ? thread.unlockMilestones
      : JSON.parse(String(thread.unlockMilestones || '[]')),
  }
}

function normalizeStage(value: number | null | undefined): 0 | 1 | 2 | 3 {
  const stage = Number(value ?? 0)
  if (stage >= 3) return 3
  if (stage >= 2) return 2
  if (stage >= 1) return 1
  return 0
}

// ── UnlockBar ────────────────────────────────────────────────────────────────

function UnlockBar({ stage }: { stage: number }) {
  return (
    <div className="flex items-center gap-3">
      {[0, 1, 2].map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center border ${
              stage > s
                ? 'bg-primary/20 border-primary/40 text-primary'
                : stage === s
                  ? 'bg-muted border-border text-muted-foreground animate-pulse'
                  : 'bg-muted/30 border-border/50 text-muted-foreground/30'
            }`}
          >
            {stage > s ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          </div>
          {s < 2 && <div className={`h-px w-8 ${stage > s ? 'bg-primary/40' : 'bg-border/40'}`} />}
        </div>
      ))}
      <span className="text-xs text-muted-foreground ml-1">
        {stage >= 3 ? '完全解锁' : `${stage}/3 已解锁`}
      </span>
    </div>
  )
}

// ── TensionReportPanel ───────────────────────────────────────────────────────

function SeverityBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, (value / 10) * 100))
  const color =
    value >= 8 ? 'bg-red-500' : value >= 5 ? 'bg-orange-400' : 'bg-yellow-400'
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-white/50 w-6 text-right">{value}/10</span>
    </div>
  )
}

function TensionReportPanel({
  tensionReport,
  onClose,
}: {
  tensionReport: string
  onClose: () => void
}) {
  const parsed = normalizeMatchAnalysis(tensionReport)
  const isStructured = !!parsed

  return (
    <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
      {!isStructured && (
        <p className="text-sm text-white/70 leading-relaxed">{tensionReport}</p>
      )}

      {isStructured && parsed && (
        <>
          {/* Critical Warning */}
          {parsed.criticalWarning && (
            <div className="flex gap-3 p-3 rounded-lg border border-red-500/40 bg-red-500/10">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300 leading-relaxed">{parsed.criticalWarning}</p>
            </div>
          )}

          {/* Tension Zones */}
          {parsed.tensionZones && parsed.tensionZones.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Zap className="h-3.5 w-3.5 text-orange-400" />
                <span className="text-[11px] uppercase tracking-widest text-orange-400 font-semibold">
                  张力热区
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                {parsed.tensionZones.map((zone, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-white/5 border border-white/10 hover:border-orange-400/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-white/90">{zone.title}</p>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          zone.severity >= 8
                            ? 'bg-red-500/20 text-red-400'
                            : zone.severity >= 5
                              ? 'bg-orange-500/20 text-orange-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {zone.severity >= 8 ? '高危' : zone.severity >= 5 ? '中危' : '低危'}
                      </span>
                    </div>
                    <p className="text-xs text-white/55 mt-1 leading-relaxed">{zone.description}</p>
                    <SeverityBar value={zone.severity} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resonance Points */}
          {parsed.resonancePoints && parsed.resonancePoints.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[11px] uppercase tracking-widest text-emerald-400 font-semibold">
                  共鸣锚点
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {parsed.resonancePoints.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-white/65 leading-relaxed">
                    <span className="mt-0.5 text-emerald-400 shrink-0">✓</span>
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Power Dynamics */}
          {parsed.powerDynamics && (
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <p className="text-[11px] uppercase tracking-widest text-white/40 mb-1.5">权力动态</p>
              <p className="text-xs text-white/65 leading-relaxed">{parsed.powerDynamics}</p>
            </div>
          )}

          {/* Growth Potential */}
          {parsed.growthPotential && (
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <p className="text-[11px] uppercase tracking-widest text-white/40 mb-1.5">成长潜力</p>
              <p className="text-xs text-white/65 leading-relaxed">{parsed.growthPotential}</p>
            </div>
          )}

          {/* Resonance Score */}
          {typeof parsed.resonanceScore === 'number' && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
              <span className="text-xs text-white/60">共鸣分数</span>
              <span className="text-lg font-bold font-mono text-primary">
                {parsed.resonanceScore}
                <span className="text-xs font-normal text-white/40">/100</span>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ThreadDetailPage() {
  const { threadId } = useParams({ from: '/thread/$threadId' })
  const navigate = useNavigate()
  const { user } = useAuth()

  const [thread, setThread] = useState<SocialThread | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [unlockStage, setUnlockStage] = useState<0 | 1 | 2 | 3>(0)
  const [icebreakers, setIcebreakers] = useState<string[]>([])
  const [tensionReport, setTensionReport] = useState('')
  const [resonanceScore, setResonanceScore] = useState<number | null>(null)
  const [unlockMilestones, setUnlockMilestones] = useState<UnlockMilestone[]>(buildMilestoneState(0))
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showTensionPanel, setShowTensionPanel] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMsgCountRef = useRef(0)

  // ── Edge function: load icebreakers ────────────────────────────────────────

  const loadIcebreakers = useCallback(async (threadData: SocialThread) => {
    if (threadData.icebreakers.length > 0) return
    if (!threadData.matchId) return
    try {
      const data = await generateIcebreakers(user?.id ?? '', threadData.id, threadData.matchId)
      if (Array.isArray(data.icebreakers)) {
        setIcebreakers(data.icebreakers)
      }
    } catch {
      // ignore
    }
  }, [user?.id])

  // ── DB: load match analysis → tension report ───────────────────────────────

  // ── Load thread ────────────────────────────────────────────────────────────

  const loadThread = useCallback(async () => {
    if (!threadId) return
    try {
      const raw = await fetchThreadById(threadId)
      if (!raw) return
      const threadData = normalizeThread(raw)

      setThread(threadData)
      setMessages(threadData.messages)
      setUnlockStage(normalizeStage(threadData.unlockState?.currentStage ?? threadData.unlockStage))
      setIcebreakers(threadData.icebreakers)
      setTensionReport(typeof threadData.tensionReport === 'string' ? threadData.tensionReport : JSON.stringify(threadData.tensionReport || {}))
      setUnlockMilestones(buildMilestoneState(normalizeStage(threadData.unlockState?.currentStage ?? threadData.unlockStage), threadData.unlockMilestones ?? []))
      lastMsgCountRef.current = threadData.messages.length

      // Try to parse resonance score from existing tension report
      if (threadData.tensionReport) {
        try {
          const parsed = typeof threadData.tensionReport === 'string' ? JSON.parse(threadData.tensionReport) : threadData.tensionReport
          if (typeof parsed.resonanceScore === 'number') {
            setResonanceScore(parsed.resonanceScore)
          }
        } catch {
          // ignore
        }
      }

      // Load icebreakers from edge function if none exist
      loadIcebreakers(threadData)
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [threadId, loadIcebreakers])

  useEffect(() => {
    loadThread()
  }, [loadThread])

  // ── Polling for new messages ───────────────────────────────────────────────

  useEffect(() => {
    if (!thread) return
    pollRef.current = setInterval(async () => {
      try {
        const raw = await fetchThreadById(threadId)
        if (!raw) return
        const t = normalizeThread(raw)
        const msgs = t.messages
        if (msgs.length !== lastMsgCountRef.current) {
          setMessages(msgs)
          const nextStage = normalizeStage(t.unlockState?.currentStage ?? t.unlockStage)
          setUnlockStage(nextStage)
          setUnlockMilestones(buildMilestoneState(nextStage, t.unlockMilestones ?? []))
          lastMsgCountRef.current = msgs.length
        }
      } catch {
        // ignore
      }
    }, POLL_INTERVAL)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [thread, threadId])

  // ── Scroll to bottom ───────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = async (content: string) => {
    if (!content.trim() || !user?.id || !thread || isSending) return
    if (thread.governanceState?.isCoolingDown) {
      toast.error('该线程正在冷却，暂时不能继续发送消息')
      return
    }
    if (thread.governanceState?.isClosed) {
      toast.error('该线程已关闭，无法继续发送消息')
      return
    }
    setIsSending(true)

    const newMsg: ThreadMessage = {
      id: `msg_${Date.now()}`,
      senderId: user.id,
      content: content.trim(),
      timestamp: new Date().toISOString(),
    }

    const nextStage = normalizeStage(Math.floor((messages.filter((m) => !m.isSystemMessage).length + 1) / 5))

    try {
      const savedThread = await upsertThread({
        ...(thread ?? {
          id: threadId,
          userIdA: user.id,
          userIdB: '',
          unlockStage: 0,
          icebreakers: [],
          tensionReport: '',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        id: threadId,
        unlockStage: nextStage,
        messages: [...messages, newMsg],
        unlockMilestones: buildMilestoneState(nextStage, unlockMilestones),
        updatedAt: new Date().toISOString(),
      })
      const normalizedSaved = normalizeThread(savedThread)
      const resolvedStage = normalizeStage(normalizedSaved.unlockState?.currentStage ?? normalizedSaved.unlockStage)
      setThread(normalizedSaved)
      setMessages(normalizedSaved.messages)
      setUnlockStage(resolvedStage)
      setUnlockMilestones(buildMilestoneState(resolvedStage, normalizedSaved.unlockMilestones ?? []))
      lastMsgCountRef.current = normalizedSaved.messages.length
      setInputValue('')
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Request failed:\s*\d+\s*/, '') : ''
      toast.error(message || '发送失败，请重试')
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputValue)
    }
  }

  const isMyMessage = (msg: ThreadMessage) => msg.senderId === user?.id

  // ── Derived: parse tension report for badge label ─────────────────────────

  const hasTensionData = tensionReport.length > 0
  const parsedTensionReport = normalizeMatchAnalysis(tensionReport)
  const unlockState = thread?.unlockState
  const contactExchangeStatus = thread?.contactExchangeStatus
  const tensionHandbook = thread?.tensionHandbook
  const stagePolicy = thread?.stagePolicy

  let tensionZoneCount = 0
  tensionZoneCount = parsedTensionReport?.tensionZones?.length ?? (hasTensionData ? 1 : 0)

  // ── Loading / not found ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={`h-12 w-${i % 2 === 0 ? '2/3' : '1/2'} rounded-xl`} />
          ))}
        </div>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground mb-3">对话未找到</p>
          <button className="text-primary text-sm" onClick={() => navigate({ to: '/thread' })}>
            返回列表
          </button>
        </div>
      </div>
    )
  }

  const isA = thread.userIdA === user?.id
  const partnerId = isA ? thread.userIdB : thread.userIdA
  const partnerAnon = `#${partnerId.slice(0, 6).toUpperCase()}`

  return (
    <div className="flex flex-col h-screen bg-background">
      {thread.governanceState && !thread.governanceState.isActive ? (
        <div className={`mx-4 mt-4 rounded-xl border px-4 py-3 ${thread.governanceState.isClosed ? 'border-destructive/30 bg-destructive/5' : 'border-[hsl(45,90%,55%)]/30 bg-[hsl(45,90%,55%)]/5'}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${thread.governanceState.isClosed ? 'text-destructive' : 'text-[hsl(45,90%,65%)]'}`} />
            <div className="space-y-1">
              <p className="text-sm text-foreground font-medium">{thread.governanceState.label}</p>
              <p className="text-xs text-muted-foreground">{thread.governanceState.reason}</p>
              {thread.governanceState.governanceNote ? <p className="text-xs text-muted-foreground">治理备注：{thread.governanceState.governanceNote}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => navigate({ to: '/thread' })}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
            <span className="text-[10px] font-mono font-bold text-accent">
              {partnerAnon.slice(1, 3)}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-mono font-semibold text-foreground">{partnerAnon}</p>
              {resonanceScore !== null && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1.5 py-0 h-4 font-mono border-primary/30 text-primary bg-primary/5"
                >
                  ◎ {resonanceScore}
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {messages.filter((m) => !m.isSystemMessage).length} 条消息
            </p>
          </div>
        </div>
        <UnlockBar stage={unlockStage} />
      </div>

      <div className="shrink-0 px-4 pt-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {unlockMilestones.map((item) => (
            <div
              key={item.stage}
              className={`rounded-xl border px-3 py-2 ${item.unlocked ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-muted/20'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{item.label}</span>
                <Badge variant="outline" className={`text-[9px] ${item.unlocked ? 'border-primary/30 text-primary' : 'border-border text-muted-foreground'}`}>
                  {item.unlocked ? '已解锁' : `Lv.${item.stage}`}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{item.requirement}</p>
              {typeof item.remainingMessageCount === 'number' && !item.unlocked ? (
                <p className="text-[10px] text-muted-foreground mt-1">还差 {item.remainingMessageCount} 条有效消息</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-4 pt-1">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="rounded-xl border border-border/60 bg-card/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">联系方式交换</p>
            <p className="text-sm text-foreground mt-1">
              {contactExchangeStatus?.allowed ? '已开放交换联系方式' : '尚未开放交换联系方式'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              {contactExchangeStatus?.reason ?? '需要完成更深阶段解锁后才能推进。'}
            </p>
            {contactExchangeStatus?.blockers?.length ? (
              <ul className="mt-2 space-y-1">
                {contactExchangeStatus.blockers.map((item, index) => (
                  <li key={index} className="text-[10px] text-muted-foreground">• {item}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">下一阶段条件</p>
            <p className="text-sm text-foreground mt-1">
              {unlockState?.isFullyUnlocked ? '当前已完成全部阶梯解锁' : `还差 ${unlockState?.remainingMessageCount ?? Math.max(0, UNLOCK_REQUIREMENTS[unlockStage + 1] - messages.filter((m) => !m.isSystemMessage).length)} 条有效消息`}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              {unlockState?.nextStage != null ? `达到 ${unlockState.nextStageRequiredMessageCount ?? UNLOCK_REQUIREMENTS[unlockState.nextStage]} 条后进入下一阶段。` : '你们已进入深层解锁，可以视情况推进到站外连接。'}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">阶段行为提示</p>
            <p className="text-sm text-foreground mt-1">{stagePolicy?.label ?? '匿名试探'}</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              {stagePolicy?.guidance ?? '当前阶段建议优先建立基础安全感。'}
            </p>
            {stagePolicy?.allowedActions?.length ? (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground mb-1">可做</p>
                <div className="flex flex-wrap gap-1">
                  {stagePolicy.allowedActions.slice(0, 3).map((item, index) => (
                    <span key={index} className="rounded-full border border-primary/20 px-2 py-0.5 text-[10px] text-primary">{item}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Floating tension button (visible when data available) ── */}
      {hasTensionData && (
        <div className="shrink-0 flex justify-end px-4 pt-2 pb-0">
          <button
            onClick={() => setShowTensionPanel(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all
              bg-red-950/60 border-red-500/30 text-red-300 hover:bg-red-900/70 hover:border-red-400/50
              shadow-[0_0_12px_rgba(239,68,68,0.15)] hover:shadow-[0_0_18px_rgba(239,68,68,0.25)]"
          >
            <AlertTriangle className="h-3 w-3" />
            <span>双人火药桶</span>
            {tensionZoneCount > 0 && (
              <span className="ml-0.5 bg-red-500/30 text-red-300 rounded-full px-1.5 py-px text-[10px] font-mono">
                {tensionZoneCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
            <Sparkles className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">开始你们的第一次对话</p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.isSystemMessage) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary">
                    {msg.content}
                  </div>
                </div>
              )
            }
            const mine = isMyMessage(msg)
            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${mine ? 'justify-end chat-bubble-right' : 'justify-start chat-bubble-left'}`}
              >
                {!mine && (
                  <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 text-[10px] font-mono font-bold text-accent">
                    {partnerAnon.slice(1, 3)}
                  </div>
                )}
                <div
                  className={`max-w-[70%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                    mine
                      ? 'bg-primary/20 border border-primary/30 text-foreground'
                      : 'bg-card border border-border text-foreground'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Icebreaker chips ── */}
      {unlockStage < 3 && icebreakers.length > 0 && (
        <div className="px-4 py-2 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground mb-1.5">破冰建议</p>
          <div className="flex flex-wrap gap-1.5">
            {icebreakers.slice(0, 3).map((ice, i) => (
              <button
                key={i}
                className="px-3 py-1 rounded-full text-xs bg-muted border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                onClick={() => setInputValue(ice)}
              >
                {ice}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input ── */}
      <div className="shrink-0 border-t border-border bg-background/80 backdrop-blur-sm px-4 py-3">
        <div className="flex gap-2 items-end">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="说点什么... (Enter 发送 · Shift+Enter 换行)"
            className="resize-none min-h-[44px] max-h-24 bg-card border-border text-foreground placeholder:text-muted-foreground text-sm"
            rows={1}
            disabled={isSending}
          />
          <Button
            size="icon"
            className="h-11 w-11 shrink-0 glow-primary"
            onClick={() => sendMessage(inputValue)}
            disabled={isSending || !inputValue.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <p className="text-[10px] text-muted-foreground">
            当前处于 {unlockMilestones.find((item) => item.stage === unlockStage)?.label ?? '匿名试探'} · 有效消息 {messages.filter((m) => !m.isSystemMessage).length} 条
          </p>
          {unlockStage < 3 && (
            <p className="text-[10px] text-muted-foreground">
              距下次解锁 {Math.max(0, UNLOCK_REQUIREMENTS[unlockStage + 1] - messages.filter((m) => !m.isSystemMessage).length)} 条
            </p>
          )}
        </div>
      </div>

      {/* ── Tension Report Modal ── */}
      <Dialog open={showTensionPanel} onOpenChange={setShowTensionPanel}>
        <DialogContent
          className="max-w-md w-full rounded-2xl border-red-500/20"
          style={{
            background: 'linear-gradient(145deg, hsl(0 20% 7%), hsl(0 15% 10%))',
            borderColor: 'rgba(239, 68, 68, 0.2)',
          }}
        >
          <DialogHeader className="pb-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="text-xl">⚠️</span>
              <span className="text-red-300 font-semibold tracking-wide">{tensionHandbook?.title ?? '避坑说明书'}</span>
              <span className="ml-1 text-[10px] uppercase tracking-widest text-red-500/60 font-mono">
                双人火药桶
              </span>
            </DialogTitle>
            <p className="text-xs text-white/40 mt-1 font-normal">
              基于双方心理画像分析生成，仅供参考
            </p>
          </DialogHeader>

          <Separator className="bg-red-500/15 mb-4" />

          {tensionHandbook?.summary ? (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-950/30 p-3">
              <p className="text-xs text-red-200/90 leading-relaxed">{tensionHandbook.summary}</p>
            </div>
          ) : null}

          <TensionReportPanel
            tensionReport={tensionReport}
            onClose={() => setShowTensionPanel(false)}
          />

          {tensionHandbook?.warnings?.length ? (
            <div className="mt-4 rounded-lg border border-red-500/20 bg-red-950/20 p-3">
              <p className="text-[11px] uppercase tracking-widest text-red-300/70 mb-2">推进提醒</p>
              <ul className="space-y-1.5">
                {tensionHandbook.warnings.slice(0, 3).map((item, index) => (
                  <li key={index} className="text-xs text-red-100/80 leading-relaxed">• {item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
