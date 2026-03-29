import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, Badge, Skeleton, Progress, EmptyState } from '../components/ui'
import { FileText, ChevronRight, Calendar, GitBranch } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { fetchReports } from '../lib/ariadneApi'
import type { InsightReport } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

function normalizeRawContent(raw: InsightReport['rawContent'] | string | undefined) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {})
  } catch {
    return {}
  }
}

function normalizeReport(report: InsightReport): InsightReport {
  const rawContent = normalizeRawContent(report.rawContent)
  return {
    ...report,
    rawContent,
    version: Number(report.version ?? 1),
    versionCount: Number(report.versionCount ?? 1),
    isLatestVersion: Boolean(report.isLatestVersion ?? true),
    lineageId: report.lineageId ?? rawContent.reportMeta?.lineageId,
    sourceSessionId: report.sourceSessionId ?? rawContent.reportMeta?.sourceSessionId,
  }
}

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
        const raw = await fetchReports(user.id)
        const normalized = (raw as InsightReport[]).map(normalizeReport)
        const latestOnly = normalized
          .filter(item => item.isLatestVersion !== false)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setReports(latestOnly)
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

            const rawContent = normalizeRawContent(report.rawContent)
            const chapters = Array.isArray(rawContent.chapters) ? rawContent.chapters : []
            const reportType = rawContent.reportMeta?.reportType === 'detailed' ? '详细版' : '报告'
            const chapterCount = chapters.length
            const coverageWarnings = rawContent.qualityFlags?.coverageWarnings ?? []
            const hasLowConfidence = rawContent.qualityFlags?.isLowConfidence

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
                        {Number(report.versionCount ?? 1) > 1 && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-primary/20 text-primary">
                            {report.versionCount} 版
                          </Badge>
                        )}
                        {chapterCount > 0 && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-primary/20 text-primary">
                            {chapterCount}章 · {reportType}
                          </Badge>
                        )}
                        {hasLowConfidence && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-[hsl(45,90%,55%)]/30 text-[hsl(45,90%,65%)]">
                            低置信
                          </Badge>
                        )}
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

                {coverageWarnings.length > 0 && (
                  <div className="rounded-lg border border-[hsl(45,90%,55%)]/20 bg-[hsl(45,90%,55%)]/5 px-3 py-2">
                    <p className="text-[10px] text-[hsl(45,90%,65%)] uppercase tracking-widest mb-1">覆盖提醒</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{coverageWarnings.join(' · ')}</p>
                  </div>
                )}

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
