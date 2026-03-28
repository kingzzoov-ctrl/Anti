// ── Core Types for Ariadne ──────────────────────────────────────────────

export type UserTier = 'Free' | 'Ad-Reward' | 'Premium'

export type SessionStage = 'DIVERGENT' | 'PRESS' | 'CONVERGE' | 'COMPLETE'
export type SessionStatus = 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'GENERATING_REPORT'

export interface UserProfile {
  id: string
  userId: string
  displayName?: string
  tier: UserTier
  tokenBalance: number
  notificationChannels: Record<string, string[]>
  matchingEnabled: boolean
  isAdmin: boolean
  createdAt: string
  updatedAt: string
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

export interface InsightReport {
  id: string
  userId: string
  title: string
  rawContent: {
    needs: ReportSection
    fears: ReportSection
    patterns: ReportSection
    contradictions: Contradiction[]
    convergence: ReportSection
    summary: string
  }
  vFeature: FeatureVector
  consistencyScore: number
  isPublic: boolean
  version: number
  createdAt: string
}

export interface MatchRecord {
  id: string
  userIdA: string
  userIdB: string
  resonanceScore: number
  matchAnalysis: string
  status: 'pending' | 'analyzing' | 'complete'
  createdAt: string
}

export interface DiscoveryCard {
  reportId: string
  anonymousId: string
  resonanceScore: number
  featureVector: FeatureVector
  consistencyScore: boolean
  overlapDimensions: string[]
  isLowFidelity: boolean
}

export interface SocialThread {
  id: string
  userIdA: string
  userIdB: string
  matchId?: string
  unlockStage: 0 | 1 | 2 | 3
  icebreakers: string[]
  tensionReport: string
  messages: ThreadMessage[]
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
  updatedAt: string
}
