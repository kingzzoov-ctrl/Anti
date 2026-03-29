import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { Button, Badge, Textarea, Skeleton, toast, LoadingOverlay } from '../components/ui'
import { Send, FlaskConical, Zap, AlertTriangle, X, ChevronRight, Circle, Download, ShieldCheck } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useUserProfile'
import { acceptPrivacyConsent, createInterviewTurnStream, createReportJob, fetchSessionById, upsertSession } from '../lib/ariadneApi'
import { buildTranscriptMarkdown } from '../lib/governanceExport'
import { getRuntimeApiBaseEnvName, getRuntimeFunctionEnvName, RUNTIME_CONFIG_KEYS } from '../lib/runtimeConfig'
import type { Message, SessionStage, InterviewSession, Contradiction } from '../types'

const stageConfig = {
  DIVERGENT: { label: 'DIVERGENT', color: 'bg-[hsl(200,70%,55%)]/20 text-[hsl(200,70%,65%)] border-[hsl(200,70%,55%)]/30' },
  PRESS: { label: 'PRESS', color: 'bg-destructive/20 text-destructive border-destructive/30' },
  CONVERGE: { label: 'CONVERGE', color: 'bg-[hsl(45,90%,55%)]/20 text-[hsl(45,90%,65%)] border-[hsl(45,90%,55%)]/30' },
  REPORT_READY: { label: 'REPORT_READY', color: 'bg-primary/20 text-primary border-primary/30' },
  COMPLETE: { label: 'COMPLETE', color: 'bg-primary/20 text-primary border-primary/30' },
} satisfies Record<SessionStage, { label: string; color: string }>

function normalizeSession(session: InterviewSession): InterviewSession {
  return {
    ...session,
    turnCount: Number(session.turnCount ?? 0),
    maxTurns: Number(session.maxTurns ?? 30),
    messages: Array.isArray(session.messages)
      ? session.messages
      : JSON.parse(String(session.messages || '[]')),
    extractedContradictions: Array.isArray(session.extractedContradictions)
      ? session.extractedContradictions
      : JSON.parse(String(session.extractedContradictions || '[]')),
    contextVariables: session.contextVariables ?? {},
    tokenConsumed: Number(session.tokenConsumed ?? 0),
    stateContext: session.stateContext,
    readiness: session.readiness ?? session.stateContext?.readiness ?? false,
    offTopicCount: Number(session.offTopicCount ?? session.stateContext?.offTopicCount ?? 0),
    badCaseFlags: session.badCaseFlags ?? session.stateContext?.badCaseFlags ?? [],
    completionReason: session.completionReason ?? session.stateContext?.completionReason ?? null,
  }
}

// ── Stage Progress Step ──────────────────────────────────────────────────────
interface StageStepProps {
  label: string
  sublabel: string
  color: string
  glowColor: string
  isActive: boolean
  isCompleted: boolean
  isPulse?: boolean
}

function StageStep({ label, sublabel, color, glowColor, isActive, isCompleted, isPulse }: StageStepProps) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div className="relative flex items-center justify-center">
        {/* Outer glow ring when active */}
        {isActive && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 14px 4px ${glowColor}` }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <motion.div
          className="w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all duration-500"
          style={{
            borderColor: isActive || isCompleted ? color : 'hsl(var(--border))',
            backgroundColor: isActive ? `${color}30` : isCompleted ? `${color}20` : 'transparent',
          }}
          animate={isPulse && isActive ? { scale: [1, 1.12, 1] } : {}}
          transition={{ duration: 1.2, repeat: Infinity }}
        >
          {isCompleted && !isActive && (
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          )}
          {isActive && (
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          )}
        </motion.div>
      </div>
      <div className="text-center leading-none">
        <span
          className="text-[9px] font-bold tracking-widest uppercase block"
          style={{ color: isActive ? color : isCompleted ? `${color}99` : 'hsl(var(--muted-foreground))' }}
        >
          {label}
        </span>
        <span className="text-[8px] text-muted-foreground/50 block hidden sm:block">{sublabel}</span>
      </div>
    </div>
  )
}

// ── Stage Progress Bar ───────────────────────────────────────────────────────
function StageProgressBar({ stage }: { stage: SessionStage }) {
  const isDivergent = stage === 'DIVERGENT'
  const isPress = stage === 'PRESS'
  const isConverge = stage === 'CONVERGE' || stage === 'COMPLETE'

  const steps: StageStepProps[] = [
    {
      label: 'DIVERGENT',
      sublabel: '发散',
      color: 'hsl(200 70% 55%)',
      glowColor: 'hsl(200 70% 55% / 0.5)',
      isActive: isDivergent,
      isCompleted: isPress || isConverge,
      isPulse: false,
    },
    {
      label: 'PRESS',
      sublabel: '施压',
      color: 'hsl(var(--destructive))',
      glowColor: 'hsl(0 72% 55% / 0.6)',
      isActive: isPress,
      isCompleted: isConverge,
      isPulse: true,
    },
    {
      label: 'CONVERGE',
      sublabel: '收敛',
      color: 'hsl(142 70% 50%)',
      glowColor: 'hsl(142 70% 50% / 0.5)',
      isActive: isConverge,
      isCompleted: false,
      isPulse: false,
    },
  ]

  // Progress line fill: 0%, 50%, 100%
  const progressPct = isDivergent ? '0%' : isPress ? '50%' : '100%'

  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-2">
          <StageStep {...step} />
          {i < steps.length - 1 && (
            <div className="relative w-8 sm:w-12 h-[2px] bg-border rounded-full overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  background:
                    i === 0
                      ? 'linear-gradient(90deg, hsl(200 70% 55%), hsl(var(--destructive)))'
                      : 'linear-gradient(90deg, hsl(var(--destructive)), hsl(142 70% 50%))',
                  width: i === 0
                    ? (isPress || isConverge ? '100%' : '0%')
                    : (isConverge ? '100%' : '0%'),
                }}
                animate={{
                  width: i === 0
                    ? (isPress || isConverge ? '100%' : '0%')
                    : (isConverge ? '100%' : '0%'),
                }}
                transition={{ duration: 0.8, ease: 'easeInOut' }}
              />
            </div>
          )}
        </div>
      ))}
      {/* Hidden for TS — use progressPct somewhere to avoid unused var */}
      <span className="sr-only">{progressPct}</span>
    </div>
  )
}

// ── Contradiction Card ───────────────────────────────────────────────────────
function ContradictionCard({ c }: { c: Contradiction }) {
  const severity = Math.min(Math.max(c.severity ?? 0, 0), 10)
  const severityPct = `${severity * 10}%`
  const severityColor =
    severity >= 7 ? 'hsl(var(--destructive))' : severity >= 4 ? 'hsl(45 90% 55%)' : 'hsl(200 70% 55%)'

  return (
    <div className="ariadne-card p-4 space-y-3">
      {/* Dimension + severity */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-foreground leading-snug">{c.dimension}</span>
        <span
          className="text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded"
          style={{ color: severityColor, background: `${severityColor}20` }}
        >
          {severity}/10
        </span>
      </div>

      {/* Severity bar */}
      <div className="w-full h-1 bg-border rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: severityColor }}
          initial={{ width: '0%' }}
          animate={{ width: severityPct }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>

      {/* Statement A vs B */}
      <div className="space-y-2">
        <div className="flex gap-2 items-start">
          <span
            className="text-[10px] font-bold shrink-0 mt-0.5 px-1 rounded"
            style={{ color: 'hsl(200 70% 65%)', background: 'hsl(200 70% 55% / 0.15)' }}
          >
            A
          </span>
          <p className="text-[11px] text-muted-foreground leading-snug">{c.userStatementA}</p>
        </div>
        <div className="flex gap-2 items-start">
          <span
            className="text-[10px] font-bold shrink-0 mt-0.5 px-1 rounded"
            style={{ color: 'hsl(var(--destructive))', background: 'hsl(var(--destructive) / 0.15)' }}
          >
            B
          </span>
          <p className="text-[11px] text-muted-foreground leading-snug">{c.userStatementB}</p>
        </div>
      </div>

      {/* AI analysis */}
      {c.aiAnalysis && (
        <p className="text-[10px] text-muted-foreground/70 border-t border-border pt-2 leading-snug">
          {c.aiAnalysis}
        </p>
      )}
    </div>
  )
}

// ── Contradiction Panel ──────────────────────────────────────────────────────
function ContradictionPanel({
  contradictions,
  isOpen,
  onClose,
}: {
  contradictions: Contradiction[]
  isOpen: boolean
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            key="panel"
            className={[
              // Mobile: bottom sheet
              'fixed bottom-0 left-0 right-0 z-50 max-h-[70vh]',
              // Desktop: right side panel
              'lg:right-0 lg:top-0 lg:bottom-0 lg:left-auto lg:w-80 lg:max-h-none lg:border-l lg:border-border',
              'bg-card overflow-hidden flex flex-col',
              // Mobile rounded top corners
              'rounded-t-2xl lg:rounded-none',
            ].join(' ')}
            initial={{ y: '100%', x: 0 }}
            animate={{ y: 0, x: 0 }}
            exit={{ y: '100%', x: 0 }}
            // Desktop overrides via inline style via variant
            style={{ willChange: 'transform' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            {/* Desktop slide from right */}
            <motion.div
              className="hidden lg:flex flex-col flex-1 overflow-hidden"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              style={{ position: 'absolute', inset: 0 }}
            >
              <PanelContent contradictions={contradictions} onClose={onClose} />
            </motion.div>

            {/* Mobile content (no extra transform) */}
            <div className="flex flex-col flex-1 overflow-hidden lg:hidden">
              <PanelContent contradictions={contradictions} onClose={onClose} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function PanelContent({ contradictions, onClose }: { contradictions: Contradiction[]; onClose: () => void }) {
  return (
    <>
      {/* Handle bar (mobile) */}
      <div className="flex justify-center pt-2 pb-1 lg:hidden">
        <div className="w-10 h-1 rounded-full bg-border" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-semibold text-foreground">矛盾提取</span>
          <span className="text-xs text-muted-foreground">({contradictions.length})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Contradiction list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {contradictions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Circle className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">尚未提取到矛盾</p>
            <p className="text-xs text-muted-foreground/60">随对话深入，矛盾将自动显现</p>
          </div>
        ) : (
          contradictions.map((c, i) => (
            <motion.div
              key={c.id ?? i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35 }}
            >
              <ContradictionCard c={c} />
            </motion.div>
          ))
        )}
      </div>
    </>
  )
}

// ── Main LabPage ─────────────────────────────────────────────────────────────
export default function LabPage() {
  const params = useParams({ strict: false }) as { sessionId?: string }
  const navigate = useNavigate()
  const { user } = useAuth()
  const { profile, refetch: refetchProfile } = useUserProfile(user?.id ?? null)

  const [messages, setMessages] = useState<Message[]>([])
  const [sessionId, setSessionId] = useState<string | null>(params.sessionId ?? null)
  const [stage, setStage] = useState<SessionStage>('DIVERGENT')
  const [turnCount, setTurnCount] = useState(0)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(!!params.sessionId)
  const [contradictions, setContradictions] = useState<Contradiction[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [runtimeWarning, setRuntimeWarning] = useState<string | null>(null)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [isSavingPrivacyConsent, setIsSavingPrivacyConsent] = useState(false)
  const [sessionMeta, setSessionMeta] = useState<Pick<InterviewSession, 'stateContext' | 'readiness' | 'offTopicCount' | 'badCaseFlags' | 'completionReason'>>({
    stateContext: undefined,
    readiness: false,
    offTopicCount: 0,
    badCaseFlags: [],
    completionReason: null,
  })
  const [reportJobProgress, setReportJobProgress] = useState<{ status: string; progress: number; label?: string } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const privacyStorageKey = user?.id ? `ariadne:privacy:${user.id}` : 'ariadne:privacy:anonymous'

  const isPress = stage === 'PRESS'

  // Load existing session
  useEffect(() => {
    try {
      setPrivacyAccepted(window.localStorage.getItem(privacyStorageKey) === 'accepted')
    } catch {
      setPrivacyAccepted(false)
    }
  }, [privacyStorageKey])

  useEffect(() => {
    if (typeof profile?.privacyConsent?.accepted === 'boolean') {
      setPrivacyAccepted(Boolean(profile.privacyConsent.accepted))
    }
  }, [profile?.privacyConsent?.accepted])

  useEffect(() => {
    if (!user?.id || profile?.privacyConsent?.accepted) return
    try {
      if (window.localStorage.getItem(privacyStorageKey) !== 'accepted') return
    } catch {
      return
    }

    let cancelled = false
    const migrateLocalConsent = async () => {
      try {
        const payload = await acceptPrivacyConsent(user.id, { version: 'lab-v1', scope: 'lab-interview' })
        if (!cancelled && payload?.consent?.accepted) {
          setPrivacyAccepted(true)
          await refetchProfile()
        }
      } catch {
        // ignore migration failure, keep local fallback
      }
    }

    migrateLocalConsent()
    return () => {
      cancelled = true
    }
  }, [privacyStorageKey, profile?.privacyConsent?.accepted, refetchProfile, user?.id])

  useEffect(() => {
    if (!params.sessionId || !user?.id) return
    const load = async () => {
      setSessionLoading(true)
      try {
        const session = await fetchSessionById(params.sessionId!)
        if (session && session.userId === user.id) {
          const s = normalizeSession(session)
          setMessages(s.messages)
          setStage(s.currentStage ?? 'DIVERGENT')
          setTurnCount(s.turnCount ?? 0)
          setSessionId(params.sessionId!)
          setContradictions(s.extractedContradictions ?? [])
          setSessionMeta({
            stateContext: s.stateContext,
            readiness: s.readiness ?? false,
            offTopicCount: s.offTopicCount ?? 0,
            badCaseFlags: s.badCaseFlags ?? [],
            completionReason: s.completionReason ?? null,
          })
        }
      } catch {
        // ignore
      } finally {
        setSessionLoading(false)
      }
    }
    load()
  }, [params.sessionId, user?.id])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const saveSessionToDB = useCallback(async (
    sid: string,
    msgs: Message[],
    currentStage: SessionStage,
    turns: number,
    currentContradictions: Contradiction[],
    status = 'IN_PROGRESS',
    extra?: Pick<InterviewSession, 'stateContext' | 'readiness' | 'offTopicCount' | 'badCaseFlags' | 'completionReason'>
  ) => {
    try {
      await upsertSession({
        id: sid,
        userId: user?.id ?? '',
        status,
        currentStage,
        turnCount: turns,
        maxTurns: 30,
        contextVariables: {},
        extractedContradictions: currentContradictions,
        messages: msgs,
        tokenConsumed: 0,
        stateContext: extra?.stateContext,
        readiness: extra?.readiness,
        offTopicCount: extra?.offTopicCount,
        badCaseFlags: extra?.badCaseFlags,
        completionReason: extra?.completionReason,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // ignore
    }
  }, [user?.id])

  const startSession = async () => {
    if (!user?.id) return
    if (!privacyAccepted) {
      toast.error('请先确认隐私与治理告知')
      return
    }
    setIsStarting(true)
    try {
      const createdAt = new Date().toISOString()
      const newSession: InterviewSession = {
        id: `sess_${user.id}_${Date.now()}`,
        userId: user.id,
        status: 'IN_PROGRESS',
        currentStage: 'DIVERGENT',
        turnCount: 0,
        maxTurns: 30,
        contextVariables: {},
        extractedContradictions: [],
        messages: [],
        tokenConsumed: 0,
        createdAt,
        updatedAt: createdAt,
      }
      const saved = await upsertSession(newSession)
      const sid = saved.id
      setSessionId(sid)
      navigate({ to: '/lab/$sessionId', params: { sessionId: sid } })

      // Send initial message
      await sendMessage('', sid, [], 'DIVERGENT', 0, [])
    } catch {
      toast.error('启动失败，请重试')
    } finally {
      setIsStarting(false)
    }
  }

  const sendMessage = async (
    userText: string,
    overrideSid?: string,
    overrideMsgs?: Message[],
    overrideStage?: SessionStage,
    overrideTurns?: number,
    overrideContradictions?: Contradiction[]
  ) => {
    const sid = overrideSid ?? sessionId
    if (!sid || !user?.id || isStreaming) return
    if (!privacyAccepted) {
      toast.error('请先确认隐私与治理告知')
      return
    }

    const currentMsgs = overrideMsgs ?? messages
    const currentStage = overrideStage ?? stage
    const currentTurns = overrideTurns ?? turnCount
    const currentContradictions = overrideContradictions ?? contradictions

    const newMsgs: Message[] = userText
      ? [...currentMsgs, { role: 'user', stage: currentStage, content: userText, timestamp: new Date().toISOString() }]
      : currentMsgs

    if (userText) {
      setMessages(newMsgs)
      setInputValue('')
    }

    setIsStreaming(true)

    // Add placeholder AI message
    const placeholderMsg: Message = { role: 'ai', stage: currentStage, content: '', timestamp: new Date().toISOString() }
    const msgsWithPlaceholder = [...newMsgs, placeholderMsg]
    setMessages(msgsWithPlaceholder)

    try {
      setRuntimeWarning(null)
      let streamedReply = ''
      const data = await createInterviewTurnStream({
        sessionId: sid,
        userMessage: userText,
        messages: newMsgs.filter(m => m.role !== 'system'),
        userId: user.id,
        currentStage,
        turnCount: currentTurns,
        maxTurns: 30,
      }, {
        onEvent: ({ event, data: streamData }) => {
          if (event === 'chunk') {
            streamedReply += String(streamData.delta ?? '')
            setMessages([
              ...newMsgs,
              { role: 'ai', stage: currentStage, content: streamedReply, timestamp: new Date().toISOString() },
            ])
          }
        },
      })
      const aiContent = String(data.assistantReply ?? '')
      const newStage = (data.currentStage ?? currentStage) as SessionStage
      const newTurns = Number(data.session?.turnCount ?? (currentTurns + (userText ? 1 : 0)))
      const incomingContradictions = Array.isArray(data.contradictions) ? data.contradictions as Contradiction[] : []
      const normalizedReturnedSession = data.session ? normalizeSession(data.session) : null
      const existingIds = new Set(currentContradictions.map(c => c.id))
      const newContradictions = [
        ...currentContradictions,
        ...incomingContradictions.filter(c => !existingIds.has(c.id)),
      ]
      setStage(newStage)
      setTurnCount(newTurns)
      setContradictions(newContradictions)
      const nextSessionMeta = {
        stateContext: normalizedReturnedSession?.stateContext,
        readiness: normalizedReturnedSession?.readiness ?? false,
        offTopicCount: normalizedReturnedSession?.offTopicCount ?? 0,
        badCaseFlags: normalizedReturnedSession?.badCaseFlags ?? [],
        completionReason: normalizedReturnedSession?.completionReason ?? null,
      }
      setSessionMeta(nextSessionMeta)

      // Finalize AI message
      const finalMsgs: Message[] = [
        ...newMsgs,
        { role: 'ai', stage: newStage, content: aiContent, timestamp: new Date().toISOString() },
      ]
      setMessages(finalMsgs)
      setTurnCount(newTurns)
      await refetchProfile()

      // Save to DB (include contradictions)
      await saveSessionToDB(sid, finalMsgs, newStage, newTurns, newContradictions, 'IN_PROGRESS', nextSessionMeta)
    } catch (error) {
      if (error instanceof Error && error.message.includes('402')) {
        toast.error('Token 余额不足，无法继续问询')
      } else if (error instanceof Error && error.message.includes('Missing runtime function URL')) {
        setRuntimeWarning(`未配置问询函数路由，请设置系统配置 ${RUNTIME_CONFIG_KEYS.interview} 或环境变量 ${getRuntimeFunctionEnvName('interview')}`)
      } else {
        toast.error('消息发送失败，请重试')
      }
      // Remove placeholder
      setMessages(prev => prev.filter((_, i) => i < prev.length - 1))
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim()) sendMessage(inputValue.trim())
    }
  }

  const generateReport = async () => {
    if (!sessionId || !user?.id) return
    setIsGeneratingReport(true)
    try {
      setRuntimeWarning(null)
      const job = await createReportJob({
        sessionId,
        userId: user.id,
        messages: messages.filter(m => m.role !== 'system'),
      })
      setReportJobProgress({
        status: job.status,
        progress: job.progress,
        label: Array.isArray(job.payload?.timeline) ? String((job.payload.timeline as Array<{ label?: string }>).slice(-1)[0]?.label ?? '') : undefined,
      })
      if (job.report?.id) {
        await refetchProfile()
        await saveSessionToDB(sessionId, messages, stage, turnCount, contradictions, 'COMPLETED', sessionMeta)
        navigate({ to: '/insight/$reportId', params: { reportId: job.report.id } })
      } else {
        toast.error('报告生成失败')
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('402')) {
        toast.error('Token 余额不足，无法生成报告')
      } else if (error instanceof Error && error.message.includes('Missing runtime function URL')) {
        setRuntimeWarning(`未配置问询函数路由，请设置系统配置 ${RUNTIME_CONFIG_KEYS.interview}、环境变量 ${getRuntimeFunctionEnvName('interview')}，或统一 API 基址 ${getRuntimeApiBaseEnvName()}`)
      } else {
        toast.error('报告生成失败，请重试')
      }
    } finally {
      setIsGeneratingReport(false)
    }
  }

  const canGenerateReport = turnCount >= 15 || stage === 'CONVERGE' || stage === 'REPORT_READY' || stage === 'COMPLETE'

  const handleAcceptPrivacy = async () => {
    if (!user?.id || isSavingPrivacyConsent) return
    setIsSavingPrivacyConsent(true)
    setPrivacyAccepted(true)
    try {
      window.localStorage.setItem(privacyStorageKey, 'accepted')
    } catch {
      // ignore
    }
    try {
      await acceptPrivacyConsent(user.id, { version: 'lab-v1', scope: 'lab-interview' })
      await refetchProfile()
      toast.success('已确认隐私告知')
    } catch {
      toast.error('隐私告知确认同步失败，已保留本地确认状态')
    } finally {
      setIsSavingPrivacyConsent(false)
    }
  }

  const exportTranscript = () => {
    if (!sessionId) return
    const content = buildTranscriptMarkdown({
      sessionId,
      stage,
      turnCount,
      readiness: sessionMeta.readiness ?? false,
      badCaseFlags: sessionMeta.badCaseFlags ?? [],
      messages,
    })
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `Ariadne_Transcript_${sessionId.slice(-6)}.md`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('会话已导出')
  }

  // Placeholder text by stage
  const inputPlaceholder =
    stage === 'PRESS'
      ? 'Ariadne 正在施压 — 你准备好了吗?...'
      : stage === 'CONVERGE' || stage === 'REPORT_READY' || stage === 'COMPLETE'
      ? '整合阶段 — 分享你的最终洞察...'
      : '输入你的回应... (Enter 发送 · Shift+Enter 换行)'

  // ── Initial screen — no session ──────────────────────────────────────────
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        {/* Background glow */}
        <div className="fixed inset-0 pointer-events-none">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-10"
            style={{ background: 'var(--gradient-primary)', filter: 'blur(100px)' }}
          />
        </div>

        <div className="relative z-10 max-w-md w-full text-center animate-fade-in space-y-8">
          <div>
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 border border-primary/20 mb-6 glow-primary">
              <FlaskConical className="h-9 w-9 text-primary" />
            </div>
            <h1 className="text-3xl font-bold gradient-text mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
              问询实验室
            </h1>
            <p className="text-muted-foreground leading-relaxed">
              Ariadne 将通过深度对话，绘制你的内心地图
            </p>
            <p className="text-muted-foreground/60 text-sm mt-2">
              约 20-30 轮对话 · 生成专属洞见报告
            </p>
          </div>

          <div className="ariadne-card p-5 text-left space-y-3">
            {[
              { stage: 'DIVERGENT', desc: '发散探索 — 开放式追问，绘制思维边界' },
              { stage: 'PRESS', desc: '施压聚焦 — 矛盾挖掘，追问深层驱动' },
              { stage: 'CONVERGE', desc: '收敛整合 — 生成你的心智特征向量' },
            ].map((s) => (
              <div key={s.stage} className="flex items-start gap-3">
                <Badge variant="outline" className={`mt-0.5 shrink-0 text-[10px] ${stageConfig[s.stage as SessionStage]?.color ?? ''}`}>
                  {s.stage}
                </Badge>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span>每轮消耗 1 Token · 当前余额: {profile?.tokenBalance ?? 0}</span>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-left space-y-2">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">治理提醒</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· 发散阶段优先扩展叙事素材，不急于下结论</li>
                <li>· 施压阶段会主动对齐矛盾点，可能带来不适</li>
                <li>· 收敛阶段建议给出清晰偏好、边界与关系判断</li>
              </ul>
            </div>

            <div className={`rounded-lg border p-3 text-left space-y-2 ${privacyAccepted ? 'border-primary/30 bg-primary/5' : 'border-[hsl(45,90%,55%)]/30 bg-[hsl(45,90%,55%)]/8'}`}>
              <div className="flex items-center gap-2">
                <ShieldCheck className={`h-4 w-4 ${privacyAccepted ? 'text-primary' : 'text-[hsl(45,90%,65%)]'}`} />
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">隐私与使用告知</p>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· 问询内容会被持久化，用于生成报告、bad-case 复盘与治理回放</li>
                <li>· 请不要提交身份证号、住址、银行卡、精确联系方式等高敏信息</li>
                <li>· 继续即表示你同意系统在治理范围内处理本次会话记录</li>
              </ul>
              {!privacyAccepted && (
                <Button size="sm" variant="outline" className="h-8 text-xs border-primary/40 text-primary hover:bg-primary/10" onClick={handleAcceptPrivacy} disabled={isSavingPrivacyConsent}>
                  {isSavingPrivacyConsent ? '确认中...' : '我已知晓并同意'}
                </Button>
              )}
            </div>

            {runtimeWarning && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{runtimeWarning}</span>
              </div>
            )}

            {(profile?.tokenBalance ?? 0) < 5 && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                余额不足，无法开始问询
              </div>
            )}

            <Button
              className="w-full h-12 text-base font-semibold glow-primary"
              onClick={startSession}
              disabled={isStarting || (profile?.tokenBalance ?? 0) < 5 || !privacyAccepted}
            >
              {isStarting ? '初始化中...' : '开始问询'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-3 text-center">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col h-screen relative overflow-hidden transition-colors duration-700 ${
        isPress ? 'bg-[hsl(0_20%_5%)]' : 'bg-background'
      }`}
    >
      {/* PRESS mode: red vignette overlay */}
      <AnimatePresence>
        {isPress && (
          <motion.div
            key="press-vignette"
            className="fixed inset-0 pointer-events-none z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 45%, hsl(0 70% 8% / 0.85) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* PRESS mode: reddish chat container tint */}
      <AnimatePresence>
        {isPress && (
          <motion.div
            key="press-tint"
            className="fixed inset-0 pointer-events-none z-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            style={{ backgroundColor: 'hsl(0 30% 6% / 0.55)' }}
          />
        )}
      </AnimatePresence>

      {isGeneratingReport && (
        <LoadingOverlay>
          <div className="text-center space-y-3">
            <p className="text-foreground font-semibold">正在生成你的洞见报告...</p>
            <p className="text-muted-foreground text-sm">Ariadne 正在整合所有对话脉络</p>
            {reportJobProgress && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>状态：{reportJobProgress.status}</p>
                <p>进度：{reportJobProgress.progress}%</p>
                {reportJobProgress.label && <p>{reportJobProgress.label}</p>}
              </div>
            )}
          </div>
        </LoadingOverlay>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className={`relative z-20 flex items-center justify-between px-4 sm:px-6 py-3 border-b shrink-0 backdrop-blur-sm transition-colors duration-700 ${
          isPress
            ? 'border-destructive/20 bg-[hsl(0_20%_5%/0.92)]'
            : 'border-border bg-background/80'
        }`}
      >
        {/* Left: Logo + session id */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <FlaskConical className={`h-4 w-4 shrink-0 ${isPress ? 'text-destructive' : 'text-primary'}`} />
          <span className="text-sm font-medium text-foreground hidden sm:block">问询实验室</span>
          <span className="text-xs text-muted-foreground font-mono hidden sm:block">#{sessionId?.slice(-6)}</span>

          {/* PRESS MODE indicator */}
          <AnimatePresence>
            {isPress && (
              <motion.div
                key="press-indicator"
                className="flex items-center gap-1.5 ml-1"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.35 }}
              >
                {/* Pulsing red dot */}
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                </span>
                <span className="text-[10px] font-bold tracking-widest text-destructive uppercase">
                  PRESS MODE — 压迫阶段
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Center: Stage progress */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <StageProgressBar stage={stage} />
        </div>

        {/* Right: Turn count + contradictions + report button */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:block">轮次 {turnCount}</span>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7 border-border text-muted-foreground hover:text-foreground"
            onClick={exportTranscript}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            导出会话
          </Button>
          <div className="hidden md:flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[9px] h-5 ${sessionMeta.readiness ? 'border-primary/40 text-primary' : 'border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,65%)]'}`}>
              {sessionMeta.readiness ? 'REPORT READY' : 'COLLECTING'}
            </Badge>
            {(sessionMeta.badCaseFlags ?? []).slice(0, 2).map(flag => (
              <Badge key={flag} variant="outline" className="text-[9px] h-5 border-destructive/40 text-destructive">
                {flag}
              </Badge>
            ))}
          </div>

          {/* Contradiction badge button */}
          <button
            onClick={() => setPanelOpen(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-colors duration-200 ${
              contradictions.length > 0
                ? 'border-destructive/30 text-destructive bg-destructive/10 hover:bg-destructive/20'
                : 'border-border text-muted-foreground hover:bg-muted/30'
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="font-mono text-[10px]">矛盾 {contradictions.length}</span>
            <ChevronRight
              className={`h-3 w-3 transition-transform duration-200 ${panelOpen ? 'rotate-90' : ''}`}
            />
          </button>

          {canGenerateReport && (
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] h-7 border-primary/40 text-primary hover:bg-primary/10"
              onClick={generateReport}
            >
              生成报告
            </Button>
          )}
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {(sessionMeta.stateContext || (sessionMeta.badCaseFlags?.length ?? 0) > 0 || sessionMeta.completionReason) && (
          <div className="max-w-3xl mx-auto rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className={`text-[10px] ${stageConfig[stage].color}`}>
                {stage}
              </Badge>
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                offTopic {sessionMeta.offTopicCount ?? 0}
              </Badge>
              {(sessionMeta.stateContext?.activeDimensions ?? []).slice(0, 4).map(item => (
                <Badge key={item} variant="outline" className="text-[10px] border-primary/30 text-primary">
                  {item}
                </Badge>
              ))}
            </div>
            {sessionMeta.completionReason && (
              <p className="text-xs text-muted-foreground">completionReason: {sessionMeta.completionReason}</p>
            )}
            {(sessionMeta.badCaseFlags?.length ?? 0) > 0 && (
              <p className="text-xs text-destructive">badCaseFlags: {sessionMeta.badCaseFlags?.join(' · ')}</p>
            )}
          </div>
        )}
        {messages.filter(m => m.role !== 'system').map((msg, idx) => {
          const isAI = msg.role === 'ai'
          const isLastAI = isAI && idx === messages.length - 1 && isStreaming
          const msgIsPress = msg.stage === 'PRESS'

          return (
            <div key={idx} className={`flex gap-3 ${isAI ? 'justify-start chat-bubble-left' : 'justify-end chat-bubble-right'}`}>
              {isAI && (
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors duration-500"
                  style={{
                    background: msgIsPress
                      ? 'hsl(var(--destructive) / 0.15)'
                      : 'hsl(var(--primary) / 0.1)',
                    border: `1px solid ${msgIsPress ? 'hsl(var(--destructive) / 0.3)' : 'hsl(var(--primary) / 0.2)'}`,
                    color: msgIsPress ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
                  }}
                >
                  A
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed transition-colors duration-500 ${
                  isAI
                    ? msgIsPress
                      ? 'bg-[hsl(0_15%_10%)] border border-destructive/20 text-foreground'
                      : 'bg-card border border-border text-foreground'
                    : 'bg-primary/20 border border-primary/30 text-foreground'
                } ${isLastAI && msg.content === '' ? 'stream-cursor' : ''}`}
              >
                {msg.content || (isLastAI ? '' : '...')}
                {isLastAI && msg.content && isStreaming && (
                  <span className="stream-cursor" />
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ──────────────────────────────────────────────────────── */}
      <div
        className={`relative z-20 shrink-0 border-t backdrop-blur-sm px-4 py-3 transition-colors duration-700 ${
          isPress
            ? 'border-destructive/20 bg-[hsl(0_20%_5%/0.92)]'
            : 'border-border bg-background/80'
        }`}
      >
        <div className="max-w-3xl mx-auto space-y-2">
          {runtimeWarning && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{runtimeWarning}</span>
            </div>
          )}

          {!privacyAccepted && (
            <div className="flex items-start justify-between gap-3 text-xs text-[hsl(45,90%,65%)] bg-[hsl(45,90%,55%)]/10 border border-[hsl(45,90%,55%)]/20 rounded-lg p-3">
              <span>发送前需先确认隐私与治理告知，避免提交高敏个人信息。</span>
              <Button size="sm" variant="outline" className="h-7 text-[10px] border-primary/40 text-primary hover:bg-primary/10" onClick={handleAcceptPrivacy}>
                立即确认
              </Button>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              className={`resize-none min-h-[52px] max-h-32 text-sm transition-colors duration-500 ${
                isPress
                  ? 'bg-[hsl(0_15%_8%)] border-destructive/30 text-foreground placeholder:text-destructive/50 focus:border-destructive/60'
                  : 'bg-card border-border text-foreground placeholder:text-muted-foreground'
              }`}
              rows={2}
              disabled={isStreaming}
            />
            <Button
              size="icon"
              className={`h-[52px] w-[52px] shrink-0 transition-all duration-500 ${
                isPress
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                  : 'glow-primary'
              }`}
              style={
                isPress
                  ? { boxShadow: '0 0 18px hsl(var(--destructive) / 0.5)' }
                  : undefined
              }
              onClick={() => inputValue.trim() && sendMessage(inputValue.trim())}
              disabled={isStreaming || !inputValue.trim() || !privacyAccepted}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
            <span>余额: {profile?.tokenBalance ?? 0} Token · 每轮消耗 1</span>
            <div className="flex items-center gap-3">
              <span>当前阶段：{stage}</span>
              {canGenerateReport && (
                <span className="text-primary">已达可生成报告条件</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Contradiction Panel ─────────────────────────────────────────────── */}
      <ContradictionPanel
        contradictions={contradictions}
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  )
}
