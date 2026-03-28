import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  Badge,
  Skeleton,
  Progress,
  EmptyState,
} from '@blinkdotnew/ui'
import { FileText, ChevronRight, Calendar, GitBranch } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { blink } from '../blink/client'
import type { InsightReport } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export default function InsightPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [reports, setReports] = useState<InsightReport[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    const fetch_ = async () => {
      setIsLoading(true)
      try {
        const raw = await blink.db.insightReports.list({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          limit: 50,
        })
        setReports(raw as unknown as InsightReport[])
      } catch {
        // ignore
      } finally {
        setIsLoading(false)
      }
    }
    fetch_()
  }, [user?.id])

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: 'var(--font-serif)' }}>
          洞见报告
        </h1>
        <p className="text-muted-foreground text-sm mt-1">你的心智图谱档案</p>
      </div>

      {/* Report grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="暂无洞见报告"
          description="完成一次完整问询后，Ariadne 将为你生成专属的心智图谱报告"
          action={{ label: '开始问询', onClick: () => navigate({ to: '/lab' }) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report) => {
            const score = Number(report.consistencyScore) || 0
            const version = Number(report.version) || 1
            let timeAgo = ''
            try {
              timeAgo = formatDistanceToNow(new Date(report.createdAt), { addSuffix: true, locale: zhCN })
            } catch {
              timeAgo = report.createdAt?.split('T')[0] ?? ''
            }

            let rawContent: { summary?: string } = {}
            try {
              rawContent = typeof report.rawContent === 'string'
                ? JSON.parse(report.rawContent)
                : (report.rawContent ?? {})
            } catch {
              rawContent = {}
            }

            const isPublic = Number(report.isPublic) > 0

            return (
              <button
                key={report.id}
                className="ariadne-card p-5 text-left hover:border-primary/40 transition-all group flex flex-col gap-4"
                onClick={() => navigate({ to: '/insight/$reportId', params: { reportId: report.id } })}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground line-clamp-1">
                        {report.title || '心智图谱报告'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <GitBranch className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">v{version}</span>
                        {isPublic && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-accent/30 text-accent">
                            公开
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
                  {rawContent.summary || '查看你的深度洞见分析报告'}
                </p>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>自洽度</span>
                    <span className="font-mono">{Math.round(score)}%</span>
                  </div>
                  <Progress value={score} className="h-1.5" />
                </div>

                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {timeAgo}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
