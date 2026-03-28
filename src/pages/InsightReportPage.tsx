import { useEffect, useState } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Skeleton,
  Progress,
  toast,
} from '@blinkdotnew/ui'
import {
  FileText,
  ChevronLeft,
  Heart,
  AlertTriangle,
  GitBranch,
  Target,
  Repeat,
  Lightbulb,
  Download,
  Globe,
  Lock,
  GitCompare,
  X,
} from 'lucide-react'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { useAuth } from '../hooks/useAuth'
import { blink } from '../blink/client'
import type { InsightReport, FeatureVector, Contradiction, ReportSection } from '../types'

const radarDimensions = [
  { key: 'v1Security', label: '安全感' },
  { key: 'v2Power', label: '权力' },
  { key: 'v3Boundary', label: '边界' },
  { key: 'v4Conflict', label: '冲突' },
  { key: 'v5Emotion', label: '情感' },
  { key: 'v6Values', label: '价值观' },
  { key: 'v7Consistency', label: '自洽度' },
]

function toRadarData(v: FeatureVector) {
  return radarDimensions.map(d => ({
    subject: d.label,
    value: Math.max(0, Math.min(100, (Number((v as Record<string, unknown>)[d.key]) || 0) * 100)),
  }))
}

function toCompareRadarData(current: FeatureVector, prev: FeatureVector) {
  return radarDimensions.map(d => ({
    subject: d.label,
    value: Math.max(0, Math.min(100, (Number((current as Record<string, unknown>)[d.key]) || 0) * 100)),
    prevValue: Math.max(0, Math.min(100, (Number((prev as Record<string, unknown>)[d.key]) || 0) * 100)),
  }))
}

function getScoreLabel(pct: number): { label: string; color: string } {
  if (pct >= 80) return { label: '高度自洽', color: 'hsl(145 55% 45%)' }
  if (pct >= 60) return { label: '较为自洽', color: 'hsl(48 90% 50%)' }
  if (pct >= 40) return { label: '内在矛盾', color: 'hsl(25 90% 52%)' }
  return { label: '严重撕裂', color: 'hsl(0 72% 55%)' }
}

function ConsistencyGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const gaugeColor = pct >= 70 ? 'hsl(165, 55%, 48%)' : pct >= 40 ? 'hsl(45, 90%, 55%)' : 'hsl(0, 72%, 55%)'
  const data = [{ value: pct }, { value: 100 - pct }]
  const { label, color } = getScoreLabel(pct)

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-28 h-28">
        <PieChart width={112} height={112}>
          <Pie
            data={data}
            cx={52}
            cy={52}
            startAngle={90}
            endAngle={-270}
            innerRadius={36}
            outerRadius={52}
            dataKey="value"
            strokeWidth={0}
          >
            <Cell fill={gaugeColor} />
            <Cell fill="hsl(240 10% 15%)" />
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <span className="text-xl font-mono font-bold" style={{ color: gaugeColor }}>{Math.round(pct)}</span>
          <span className="text-[9px] text-muted-foreground">%</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground">自洽度</span>
      <span
        className="text-[11px] font-medium mt-0.5 px-2 py-0.5 rounded-full"
        style={{ color, backgroundColor: `${color}18`, border: `1px solid ${color}40` }}
      >
        {label}
      </span>
    </div>
  )
}

function SectionCard({ icon, title, section }: { icon: React.ReactNode; title: string; section: ReportSection }) {
  if (!section) return null
  return (
    <Card className="ariadne-card border-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span style={{ fontFamily: 'var(--font-serif)' }}>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">{section.content}</p>
        {section.keyPoints?.length > 0 && (
          <ul className="space-y-1.5">
            {section.keyPoints.map((pt, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                <span className="text-primary mt-1">›</span>
                {pt}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Version Timeline ──────────────────────────────────────────────────────────

function VersionTimeline({
  versions,
  selectedId,
  onSelect,
}: {
  versions: InsightReport[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  // sort oldest → newest
  const sorted = [...versions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-center gap-0 min-w-max px-1">
        {sorted.map((v, idx) => {
          const isSelected = v.id === selectedId
          const score = Math.round(Number(v.consistencyScore) || 0)
          const scoreColor =
            score >= 80
              ? 'hsl(145 55% 45%)'
              : score >= 60
              ? 'hsl(48 90% 50%)'
              : score >= 40
              ? 'hsl(25 90% 52%)'
              : 'hsl(0 72% 55%)'

          return (
            <div key={v.id} className="flex items-center">
              {/* Timeline node */}
              <button
                onClick={() => onSelect(v.id)}
                className="flex flex-col items-center gap-1 group transition-all duration-200"
                style={{ minWidth: 72 }}
              >
                {/* Dot */}
                <div
                  className="relative flex items-center justify-center rounded-full transition-all duration-200"
                  style={{
                    width: isSelected ? 36 : 28,
                    height: isSelected ? 36 : 28,
                    background: isSelected
                      ? 'hsl(330 72% 62% / 0.2)'
                      : 'hsl(240 10% 16%)',
                    border: `2px solid ${isSelected ? 'hsl(330 72% 62%)' : 'hsl(240 10% 28%)'}`,
                    boxShadow: isSelected
                      ? '0 0 0 4px hsl(330 72% 62% / 0.15), 0 0 16px hsl(330 72% 62% / 0.3)'
                      : 'none',
                  }}
                >
                  <span
                    className="font-mono font-bold"
                    style={{
                      fontSize: isSelected ? 11 : 9,
                      color: isSelected ? 'hsl(330 72% 70%)' : 'hsl(240 8% 52%)',
                    }}
                  >
                    v{v.version}
                  </span>
                </div>
                {/* Date */}
                <span
                  className="text-[9px] transition-colors duration-200"
                  style={{ color: isSelected ? 'hsl(330 72% 70%)' : 'hsl(240 8% 48%)' }}
                >
                  {formatDate(v.createdAt)}
                </span>
                {/* Score */}
                <span
                  className="text-[9px] font-mono font-bold"
                  style={{ color: scoreColor }}
                >
                  {score}%
                </span>
              </button>

              {/* Connector line (not after last node) */}
              {idx < sorted.length - 1 && (
                <div
                  className="h-px flex-shrink-0"
                  style={{
                    width: 24,
                    background: 'linear-gradient(to right, hsl(240 10% 22%), hsl(240 10% 28%))',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Compare Panel ─────────────────────────────────────────────────────────────

function ComparePanel({
  current,
  prev,
  onClose,
}: {
  current: InsightReport
  prev: InsightReport
  onClose: () => void
}) {
  const currentScore = Math.round(Number(current.consistencyScore) || 0)
  const prevScore = Math.round(Number(prev.consistencyScore) || 0)
  const delta = currentScore - prevScore
  const deltaColor = delta >= 0 ? 'hsl(145 55% 45%)' : 'hsl(0 72% 55%)'
  const deltaLabel = delta >= 0 ? `+${delta}% ↑ 自洽度提升` : `${delta}% ↓ 自洽度下降`

  const compareData =
    current.vFeature && prev.vFeature
      ? toCompareRadarData(current.vFeature, prev.vFeature)
      : []

  return (
    <Card className="ariadne-card border-0 animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle
            className="text-sm font-medium flex items-center gap-2"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            <GitCompare className="h-4 w-4 text-primary" />
            版本对比
            <span className="text-[10px] text-muted-foreground font-normal">
              v{prev.version} → v{current.version}
            </span>
          </CardTitle>
          <div className="flex items-center gap-3">
            <span
              className="text-xs font-mono font-bold px-2 py-0.5 rounded-full"
              style={{
                color: deltaColor,
                background: `${deltaColor}1a`,
                border: `1px solid ${deltaColor}40`,
              }}
            >
              {deltaLabel}
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Side-by-side summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg p-4 space-y-2" style={{ background: 'hsl(200 70% 55% / 0.06)', border: '1px solid hsl(200 70% 55% / 0.2)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: 'hsl(200 70% 55% / 0.15)', color: 'hsl(200 70% 65%)' }}
              >
                v{prev.version}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(prev.createdAt).toLocaleDateString('zh-CN')}
              </span>
              <span className="text-[10px] font-mono" style={{ color: 'hsl(200 70% 65%)' }}>
                {prevScore}%
              </span>
            </div>
            <p className="text-xs text-foreground/70 leading-relaxed line-clamp-6">
              {prev.rawContent?.summary || '暂无摘要'}
            </p>
          </div>

          <div className="rounded-lg p-4 space-y-2" style={{ background: 'hsl(330 72% 62% / 0.06)', border: '1px solid hsl(330 72% 62% / 0.2)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: 'hsl(330 72% 62% / 0.15)', color: 'hsl(330 72% 72%)' }}
              >
                v{current.version} (当前)
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(current.createdAt).toLocaleDateString('zh-CN')}
              </span>
              <span className="text-[10px] font-mono" style={{ color: 'hsl(330 72% 72%)' }}>
                {currentScore}%
              </span>
            </div>
            <p className="text-xs text-foreground/70 leading-relaxed line-clamp-6">
              {current.rawContent?.summary || '暂无摘要'}
            </p>
          </div>
        </div>

        {/* Overlapping radar chart */}
        {compareData.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-3 text-center">七维对比雷达图</p>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={compareData}>
                <PolarGrid stroke="hsl(240 10% 20%)" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: 'hsl(240 8% 52%)' }} />
                <Radar
                  name={`上一版本 v${prev.version}`}
                  dataKey="prevValue"
                  stroke="hsl(200 70% 55%)"
                  fill="hsl(200 70% 55%)"
                  fillOpacity={0.1}
                  strokeWidth={1.5}
                />
                <Radar
                  name={`当前版本 v${current.version}`}
                  dataKey="value"
                  stroke="hsl(330 72% 62%)"
                  fill="hsl(330 72% 62%)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 10, color: 'hsl(240 8% 52%)' }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InsightReportPage() {
  const { reportId } = useParams({ from: '/insight/$reportId' })
  const navigate = useNavigate()
  const { user } = useAuth()
  const [report, setReport] = useState<InsightReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [allVersions, setAllVersions] = useState<InsightReport[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string>(reportId)
  const [compareMode, setCompareMode] = useState(false)
  const [compareReport, setCompareReport] = useState<InsightReport | null>(null)
  const [isPublicToggling, setIsPublicToggling] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      setIsLoading(true)
      try {
        const raw = await blink.db.insightReports.get(reportId)
        if (!raw) return
        const r = raw as unknown as InsightReport & { rawContent: string | InsightReport['rawContent']; vFeature: string | FeatureVector }
        const parsed: InsightReport = {
          ...r,
          rawContent: typeof r.rawContent === 'string' ? JSON.parse(r.rawContent || '{}') : (r.rawContent ?? {}),
          vFeature: typeof r.vFeature === 'string' ? JSON.parse(r.vFeature || '{}') : (r.vFeature ?? {}),
          isPublic: Number(r.isPublic) > 0,
        }
        setReport(parsed)

        // Load all versions for same user
        const versions = await blink.db.insightReports.list({
          where: { userId: user.id },
          orderBy: { version: 'desc' },
          limit: 20,
        })
        setAllVersions(versions as unknown as InsightReport[])
      } catch {
        // ignore
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [reportId, user?.id])

  const handleVersionChange = (vid: string) => {
    setSelectedVersion(vid)
    setCompareMode(false)
    setCompareReport(null)
    navigate({ to: '/insight/$reportId', params: { reportId: vid } })
  }

  const handleEnterCompare = () => {
    if (!report || allVersions.length < 2) return
    // Find the version just before current in sorted order
    const sorted = [...allVersions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    const currentIdx = sorted.findIndex(v => v.id === report.id)
    if (currentIdx <= 0) {
      toast('没有更早的版本可供对比', { description: '当前已是最早版本' })
      return
    }
    const prev = sorted[currentIdx - 1]
    // Parse prev rawContent / vFeature if needed
    const prevParsed = {
      ...prev,
      rawContent:
        typeof (prev as unknown as { rawContent: string }).rawContent === 'string'
          ? JSON.parse((prev as unknown as { rawContent: string }).rawContent || '{}')
          : (prev.rawContent ?? {}),
      vFeature:
        typeof (prev as unknown as { vFeature: string }).vFeature === 'string'
          ? JSON.parse((prev as unknown as { vFeature: string }).vFeature || '{}')
          : (prev.vFeature ?? {}),
    } as InsightReport
    setCompareReport(prevParsed)
    setCompareMode(true)
  }

  const handleTogglePublic = async () => {
    if (!report) return
    setIsPublicToggling(true)
    try {
      const newVal = !report.isPublic
      await blink.db.insightReports.update(reportId, { isPublic: newVal ? '1' : '0' })
      setReport(prev => prev ? { ...prev, isPublic: newVal } : prev)
      toast.success(newVal ? '已公开至发现广场' : '已设为私密', {
        description: newVal ? '其他用户现在可以发现你的报告' : '报告已从发现广场隐藏',
      })
    } catch {
      toast.error('操作失败', { description: '请稍后重试' })
    } finally {
      setIsPublicToggling(false)
    }
  }

  const exportReport = () => {
    if (!report) return
    const content = [
      `# ${report.title}`,
      `> 生成时间: ${new Date(report.createdAt).toLocaleDateString('zh-CN')} | 自洽度: ${Math.round(Number(report.consistencyScore))}%`,
      ``,
      `## 综合摘要`,
      report.rawContent?.summary || '',
      ``,
      `## 核心需求`,
      report.rawContent?.needs?.content || '',
      ...(report.rawContent?.needs?.keyPoints || []).map(p => `- ${p}`),
      ``,
      `## 深层恐惧`,
      report.rawContent?.fears?.content || '',
      ...(report.rawContent?.fears?.keyPoints || []).map(p => `- ${p}`),
      ``,
      `## 关系模式`,
      report.rawContent?.patterns?.content || '',
      ...(report.rawContent?.patterns?.keyPoints || []).map(p => `- ${p}`),
      ``,
      `## 收敛洞见`,
      report.rawContent?.convergence?.content || '',
      ...(report.rawContent?.convergence?.keyPoints || []).map(p => `- ${p}`),
    ].join('\n')

    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Ariadne_Report_${report.id.slice(-6)}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('导出成功', { description: '报告已下载为 Markdown 文件' })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4 animate-fade-in">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-foreground">报告未找到</p>
          <button className="text-primary text-sm" onClick={() => navigate({ to: '/insight' })}>
            返回报告列表
          </button>
        </div>
      </div>
    )
  }

  const radarData = report.vFeature ? toRadarData(report.vFeature) : []
  const contradictions: Contradiction[] = report.rawContent?.contradictions ?? []

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 animate-fade-in">
      {/* Nav */}
      <button
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => navigate({ to: '/insight' })}
      >
        <ChevronLeft className="h-4 w-4" />
        洞见报告
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: 'var(--font-serif)' }}>
            {report.title || '心智图谱报告'}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
              <GitBranch className="h-3 w-3 mr-1" />
              v{report.version ?? 1}
            </Badge>
            {report.isPublic && (
              <Badge variant="outline" className="text-[10px] border-accent/30 text-accent">公开</Badge>
            )}
            <span className="text-[10px] text-muted-foreground">
              {new Date(report.createdAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Compare button */}
          {allVersions.length > 1 && (
            <button
              onClick={compareMode ? () => { setCompareMode(false); setCompareReport(null) } : handleEnterCompare}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${
                compareMode
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
              }`}
            >
              <GitCompare className="h-3.5 w-3.5" />
              {compareMode ? '退出对比' : '对比前版本'}
            </button>
          )}

          {/* Toggle public */}
          <button
            onClick={handleTogglePublic}
            disabled={isPublicToggling}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 disabled:opacity-50 ${
              report.isPublic
                ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
                : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
            }`}
          >
            {report.isPublic ? (
              <>
                <Globe className="h-3.5 w-3.5" />
                已公开
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" />
                公开至发现广场
              </>
            )}
          </button>

          {/* Export */}
          <button
            onClick={exportReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:border-border/80 hover:text-foreground transition-all duration-200"
          >
            <Download className="h-3.5 w-3.5" />
            导出报告
          </button>
        </div>
      </div>

      {/* Version Evolution Timeline */}
      {allVersions.length > 1 && (
        <Card className="ariadne-card border-0">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              版本演进时间轴
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <VersionTimeline
              versions={allVersions}
              selectedId={selectedVersion}
              onSelect={handleVersionChange}
            />
          </CardContent>
        </Card>
      )}

      {/* Compare Panel */}
      {compareMode && compareReport && (
        <ComparePanel
          current={report}
          prev={compareReport}
          onClose={() => { setCompareMode(false); setCompareReport(null) }}
        />
      )}

      {/* Summary + radar + gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="ariadne-card border-0 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium" style={{ fontFamily: 'var(--font-serif)' }}>综合摘要</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {report.rawContent?.summary || '暂无摘要'}
            </p>
          </CardContent>
        </Card>

        <Card className="ariadne-card border-0">
          <CardContent className="flex flex-col items-center justify-center pt-6 gap-4">
            <ConsistencyGauge score={Number(report.consistencyScore) || 0} />
            {radarData.length > 0 && (
              <ResponsiveContainer width="100%" height={160}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="hsl(240 10% 20%)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: 'hsl(240 8% 52%)' }} />
                  <Radar
                    dataKey="value"
                    stroke="hsl(330 72% 62%)"
                    fill="hsl(330 72% 62%)"
                    fillOpacity={0.15}
                    strokeWidth={1.5}
                  />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 5 report sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard icon={<Target className="h-4 w-4" />} title="核心需求" section={report.rawContent?.needs} />
        <SectionCard icon={<Heart className="h-4 w-4" />} title="深层恐惧" section={report.rawContent?.fears} />
        <SectionCard icon={<Repeat className="h-4 w-4" />} title="关系模式" section={report.rawContent?.patterns} />
        <SectionCard icon={<Lightbulb className="h-4 w-4" />} title="收敛洞见" section={report.rawContent?.convergence} />
      </div>

      {/* Contradictions */}
      {contradictions.length > 0 && (
        <Card className="ariadne-card border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2" style={{ fontFamily: 'var(--font-serif)' }}>
              <AlertTriangle className="h-4 w-4 text-[hsl(45,90%,55%)]" />
              矛盾记录
              <Badge variant="outline" className="text-[10px] border-border">{contradictions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {contradictions.map((c, i) => (
                <div key={i} className="p-4 rounded-lg bg-muted/30 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                      {c.dimension}
                    </Badge>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">强度</span>
                      <div className="w-20">
                        <Progress
                          value={(c.severity ?? 0) * 20}
                          className="h-1.5"
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">{c.severity}/5</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[hsl(200,70%,55%)]/10 border border-[hsl(200,70%,55%)]/20 rounded p-2">
                      <p className="text-[10px] text-[hsl(200,70%,65%)] mb-1">陈述 A</p>
                      <p className="text-xs text-foreground">{c.userStatementA}</p>
                    </div>
                    <div className="bg-destructive/10 border border-destructive/20 rounded p-2">
                      <p className="text-[10px] text-destructive mb-1">陈述 B</p>
                      <p className="text-xs text-foreground">{c.userStatementB}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground italic">{c.aiAnalysis}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
