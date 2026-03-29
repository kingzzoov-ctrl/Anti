import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, Badge, Skeleton, EmptyState } from '../components/ui'
import { MessageCircle, ChevronRight, Lock, Unlock } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { fetchThreads } from '../lib/ariadneApi'
import type { SocialThread, ThreadMessage, MatchAnalysisPayload, UnlockMilestone } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const stageBadge = (stage: number) => {
  if (stage >= 3) return { label: '完全解锁', color: 'border-[hsl(165,55%,48%)]/40 text-[hsl(165,55%,48%)]', icon: <Unlock className="h-3 w-3" /> }
  if (stage >= 2) return { label: '阶段 2/3', color: 'border-[hsl(45,90%,55%)]/40 text-[hsl(45,90%,55%)]', icon: <Unlock className="h-3 w-3" /> }
  if (stage >= 1) return { label: '阶段 1/3', color: 'border-accent/40 text-accent', icon: <Lock className="h-3 w-3" /> }
  return { label: '初始阶段', color: 'border-border text-muted-foreground', icon: <Lock className="h-3 w-3" /> }
}

function parseMatchAnalysis(input: unknown): MatchAnalysisPayload | null {
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input
    return parsed && typeof parsed === 'object' ? parsed as MatchAnalysisPayload : null
  } catch {
    return null
  }
}

function parseMilestones(input: unknown): UnlockMilestone[] {
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input
    return Array.isArray(parsed) ? parsed as UnlockMilestone[] : []
  } catch {
    return []
  }
}

export default function ThreadPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [threads, setThreads] = useState<SocialThread[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      setIsLoading(true)
      try {
        const all = (await fetchThreads(user.id))
          .map(t => ({
            ...t,
            messages: typeof t.messages === 'string' ? JSON.parse(t.messages || '[]') : (t.messages ?? []),
            icebreakers: typeof t.icebreakers === 'string' ? JSON.parse(t.icebreakers || '[]') : (t.icebreakers ?? []),
            unlockStage: Number(t.unlockStage) as 0 | 1 | 2 | 3,
            tensionReport: parseMatchAnalysis(t.tensionReport) ?? t.tensionReport,
            unlockMilestones: parseMilestones(t.unlockMilestones),
          }))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        setThreads(all)
      } catch {
        // ignore
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [user?.id])

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: 'var(--font-serif)' }}>
          The Thread
        </h1>
        <p className="text-muted-foreground text-sm mt-1">与共鸣灵魂的深度连接</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          icon={<MessageCircle />}
          title="暂无对话"
          description="前往 Discovery 发现与你共鸣的灵魂，建立连接后开始对话"
          action={{ label: '探索发现', onClick: () => navigate({ to: '/discovery' }) }}
        />
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => {
            const isA = thread.userIdA === user?.id
            const partnerId = isA ? thread.userIdB : thread.userIdA
            const partnerAnon = partnerId.slice(0, 6).toUpperCase()
            const lastMsg = thread.messages[thread.messages.length - 1] as ThreadMessage | undefined
            const badge = stageBadge(thread.unlockStage)
            const tension = parseMatchAnalysis(thread.tensionReport)
            const unlockedLabel = thread.unlockMilestones?.find((item) => item.stage === thread.unlockStage)?.label
            const remainingToNext = thread.unlockState?.remainingMessageCount ?? 0
            const contactStatus = thread.contactExchangeStatus
            const blocker = contactStatus?.blockers?.[0]
            const governance = thread.governanceState

            let timeAgo = ''
            try {
              timeAgo = formatDistanceToNow(new Date(thread.updatedAt || thread.createdAt), { addSuffix: true, locale: zhCN })
            } catch {
              timeAgo = ''
            }

            return (
              <button
                key={thread.id}
                className="w-full ariadne-card p-4 flex items-center gap-4 hover:border-primary/40 transition-all text-left"
                onClick={() => navigate({ to: '/thread/$threadId', params: { threadId: thread.id } })}
              >
                <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                  <span className="text-xs font-mono font-bold text-accent">#{partnerAnon.slice(0, 2)}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-foreground font-mono">#{partnerAnon}</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] h-4 px-1.5 flex items-center gap-1 ${badge.color}`}
                    >
                      {badge.icon}
                      {badge.label}
                    </Badge>
                    {tension?.relationshipFit && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/30 text-primary">
                        {tension.relationshipFit.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {lastMsg
                      ? (lastMsg.isSystemMessage
                          ? `[系统] ${lastMsg.content.slice(0, 50)}`
                          : lastMsg.content.slice(0, 60))
                      : '还没有消息，打个招呼吧'}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                    <span>{unlockedLabel ?? '匿名试探'}</span>
                    {governance?.isCoolingDown ? <span className="text-[hsl(45,90%,65%)]">线程冷却中</span> : null}
                    {governance?.isClosed ? <span className="text-destructive">线程已关闭</span> : null}
                    {tension?.tensionZones?.length ? <span>张力点 {tension.tensionZones.length}</span> : null}
                    {thread.unlockStage < 3 ? <span>距下一阶段 {remainingToNext} 条</span> : null}
                    {contactStatus?.allowed ? <span className="text-[hsl(165,55%,48%)]">可交换联系方式</span> : null}
                    {!contactStatus?.allowed && blocker ? <span>{blocker}</span> : null}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
                  <span className="text-[10px] text-muted-foreground">{thread.messages.length} 条</span>
                </div>

                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
