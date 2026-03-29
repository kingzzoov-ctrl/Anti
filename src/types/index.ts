// ── Core Types for Ariadne ──────────────────────────────────────────────

export type UserTier = 'Free' | 'Ad-Reward' | 'Premium'

export type SessionStage = 'DIVERGENT' | 'PRESS' | 'CONVERGE' | 'REPORT_READY' | 'COMPLETE'
export type SessionStatus = 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'GENERATING_REPORT'

export interface SessionStateContext {
  readiness?: boolean
  offTopicCount?: number
  badCaseFlags?: string[]
  completionReason?: string | null
  activeDimensions?: string[]
  consistencyProxy?: number
  stateContextVersion?: string
}

export interface UserProfile {
  id: string
  userId: string
  displayName?: string
  tier: UserTier
  tokenBalance: number
  notificationChannels: Record<string, unknown>
  matchingEnabled: boolean
  privacyConsent?: PrivacyConsent
  isAdmin: boolean
  createdAt: string
  updatedAt: string
}

export interface PrivacyConsent {
  accepted: boolean
  acceptedAt?: string | null
  version?: string | null
  scope?: string | null
}

export interface Contradiction {
  id: string
  dimension: string
  userStatementA: string
  userStatementB: string
  aiAnalysis: string
  severity: number
}

export interface Message {
  role: 'system' | 'ai' | 'user'
  stage: SessionStage | 'INIT'
  content: string
  timestamp?: string
}

export interface InterviewSession {
  id: string
  userId: string
  status: SessionStatus
  currentStage: SessionStage
  turnCount: number
  maxTurns: number
  contextVariables: Record<string, string>
  extractedContradictions: Contradiction[]
  messages: Message[]
  tokenConsumed: number
  stateContext?: SessionStateContext
  readiness?: boolean
  offTopicCount?: number
  badCaseFlags?: string[]
  completionReason?: string | null
  createdAt: string
  updatedAt: string
}

// 7-Thread Feature Vector
export interface FeatureVector {
  v1Security: number     // 独立回避 <-> 焦虑融合
  v2Power: number        // 适应追随 <-> 主导控制
  v3Boundary: number     // 开放共享 <-> 极度防御
  v4Conflict: number     // 逃避冷战 <-> 激烈对抗
  v5Emotion: number      // 钝感实用 <-> 高敏共情
  v6Values: number       // 价值锚点哈希（归一化）
  v7Consistency: number  // 自洽度系数
}

export interface ReportSection {
  title: string
  content: string
  keyPoints: string[]
}

export type ReportConfidence = 'high' | 'medium' | 'low'
export type ReportChapterStatus = 'complete' | 'partial'

export interface ReportChapter {
  id:
    | 'profile'
    | 'relationship_positioning'
    | 'surface_preferences'
    | 'deep_needs'
    | 'cognitive_pattern'
    | 'preference_need_mapping'
    | 'relationship_pattern'
    | 'guidance'
    | 'probability_assessment'
    | 'closing'
    | string
  title: string
  summary: string
  content: string
  keyPoints: string[]
  confidence: ReportConfidence
  evidenceQuotes: string[]
  status: ReportChapterStatus
}

export interface ReportMeta {
  schemaVersion: string
  promptAssetVersion: string
  reportType: 'brief' | 'detailed' | string
  lineageId?: string
  generatedAt: string
  language: string
  sourceSessionId?: string
  turnCount?: number
  stateContextVersion?: string
}

export interface LegacyReportSections {
  needs?: ReportSection
  fears?: ReportSection
  patterns?: ReportSection
  convergence?: ReportSection
}

export interface FeatureAnalysis {
  vFeature: FeatureVector
  consistencyScore: number
  vectorNarrative?: string
}

export interface ReportQualityFlags {
  isLowConfidence: boolean
  hasOpenContradictions: boolean
  coverageWarnings: string[]
  missingDimensions?: string[]
}

export interface ReportStateContext {
  lastStage?: string
  primaryFocusDimension?: string
  relationshipGoal?: string
  defenseMode?: string
  communicationStyle?: string
  latestUserSignal?: string
}

export interface ReportRawContent {
  reportMeta?: ReportMeta
  summary?: string
  legacySections?: LegacyReportSections
  chapters?: ReportChapter[]
  contradictions?: Contradiction[]
  featureAnalysis?: FeatureAnalysis
  qualityFlags?: ReportQualityFlags
  keywordSignals?: string[]
  dimensionLabels?: Record<string, string>
  stateContext?: ReportStateContext
  needs?: ReportSection
  fears?: ReportSection
  patterns?: ReportSection
  convergence?: ReportSection
}

export interface InsightReport {
  id: string
  userId: string
  title: string
  rawContent: ReportRawContent
  vFeature: FeatureVector
  vEmbedding?: number[]
  consistencyScore: number
  isPublic: boolean
  version: number
  lineageId?: string
  sourceSessionId?: string
  versionCount?: number
  isLatestVersion?: boolean
  latestReportId?: string
  previousVersionId?: string | null
  createdAt: string
}

export interface ReportJob {
  id: string
  userId: string
  sessionId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  reportId?: string | null
  errorMessage?: string | null
  payload: Record<string, unknown>
  report?: InsightReport | null
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  completedAt?: string | null
}

export interface NotificationEvent {
  id: string
  userId: string
  kind: string
  channel: string
  status: 'queued' | 'running' | 'delivered' | 'skipped' | 'failed' | string
  title: string
  body: string
  payload: Record<string, unknown>
  idempotencyKey?: string | null
  retryCount: number
  maxRetries: number
  lastError?: string | null
  deadLetteredAt?: string | null
  sourceKind?: string | null
  sourceId?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  scheduledAt?: string | null
  startedAt?: string | null
  deliveredAt?: string | null
}

export interface MatchRecord {
  id: string
  userIdA: string
  userIdB: string
  sourceReportId?: string
  resonanceScore: number
  matchAnalysis: MatchAnalysisPayload | string
  status: 'pending' | 'analyzing' | 'complete'
  createdAt: string
}

export interface RelationshipFitSummary {
  label: string
  score: number
  description: string
}

export interface TensionZone {
  title: string
  description: string
  severity: number
}

export interface UnlockMilestone {
  stage: 0 | 1 | 2 | 3
  label: string
  requirement: string
  unlocked: boolean
  requiredMessageCount?: number
  remainingMessageCount?: number
}

export interface ThreadUnlockState {
  effectiveMessageCount: number
  currentStage: 0 | 1 | 2 | 3
  nextStage?: 0 | 1 | 2 | 3 | null
  nextStageRequiredMessageCount?: number | null
  remainingMessageCount: number
  isFullyUnlocked: boolean
}

export interface ThreadContactExchangeStatus {
  allowed: boolean
  requiredStage: 3
  requiredMessageCount: number
  remainingMessageCount: number
  criticalWarning?: string | null
  relationshipFitLabel?: string | null
  relationshipFitScore?: number
  severeZoneCount?: number
  blockers?: string[]
  reason: string
}

export interface ThreadTensionHandbook {
  title: string
  summary: string
  criticalWarning?: string | null
  guidance: string[]
  hotspots: TensionZone[]
  warnings: string[]
}

export interface ThreadStagePolicy {
  stage: 0 | 1 | 2 | 3
  label: string
  allowedActions: string[]
  blockedActions: string[]
  guidance: string
}

export interface ThreadGovernanceState {
  status: 'active' | 'cooldown' | 'closed' | string
  label: string
  isActive: boolean
  isCoolingDown: boolean
  isClosed: boolean
  cooldownUntil?: string | null
  closedAt?: string | null
  governanceNote?: string | null
  reason: string
}

export interface MatchAnalysisPayload {
  resonanceScore: number
  resonancePoints: string[]
  tensionZones: TensionZone[]
  powerDynamics: string
  growthPotential: string
  criticalWarning: string | null
  icebreakers: string[]
  summary: string
  embeddingScore?: number
  candidateSource?: 'vector-recall' | 'direct-report'
  relationshipFit?: RelationshipFitSummary
  guidance?: string[]
  unlockMilestones?: UnlockMilestone[]
}

export interface DiscoveryCard {
  reportId: string
  anonymousId: string
  resonanceScore: number
  featureVector: FeatureVector
  consistencyScore: number
  embeddingScore?: number
  exposureCount?: number
  visibilityScore?: number
  overlapDimensions: string[]
  isLowFidelity: boolean
  relationshipFit?: RelationshipFitSummary
  reportType?: string
  chapterCount?: number
}

export interface SocialThread {
  id: string
  userIdA: string
  userIdB: string
  matchId?: string
  unlockStage: 0 | 1 | 2 | 3
  icebreakers: string[]
  tensionReport: MatchAnalysisPayload | string
  messages: ThreadMessage[]
  unlockMilestones?: UnlockMilestone[]
  unlockState?: ThreadUnlockState
  stagePolicy?: ThreadStagePolicy
  tensionHandbook?: ThreadTensionHandbook
  contactExchangeStatus?: ThreadContactExchangeStatus
  status?: 'active' | 'cooldown' | 'closed' | string
  cooldownUntil?: string | null
  closedAt?: string | null
  governanceNote?: string | null
  governanceState?: ThreadGovernanceState
  createdAt: string
  updatedAt: string
}

export interface ThreadMessage {
  id: string
  senderId: string
  content: string
  timestamp: string
  isSystemMessage?: boolean
}

export interface SystemConfig {
  key: string
  value: string
  type: 'int' | 'float' | 'string' | 'bool'
  description?: string
  source?: 'system-config' | 'env-default' | string
  updatedAt: string
}

export interface StrategyAsset {
  id: number
  assetKey: string
  version: string
  assetType: string
  title: string
  content: string
  sourcePath: string
  isActive: boolean
  activatedFromVersion?: string | null
  rollbackNote?: string | null
  rollbackOperator?: string | null
  rollbackAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}
