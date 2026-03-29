import { authApi } from './localApi'
import { getRuntimeApiBaseUrl } from './runtimeConfig'
import type { DiscoveryCard, InsightReport, InterviewSession, MatchAnalysisPayload, MatchRecord, ReportJob, SocialThread, StrategyAsset, SystemConfig, UserProfile } from '../types'

export interface ExposureLogSummary {
  id: string
  userId: string
  date: string
  dailyExposureCount: number
}

export interface RuntimeStats {
  users: number
  sessions: number
  reports: number
  matches: number
  todayExposures: number
}

export interface IcebreakersPayload {
  items: string[]
  icebreakers: string[]
  matchId?: string
}

export interface InterviewTurnPayload {
  session: InterviewSession
  assistantReply: string
  currentStage: InterviewSession['currentStage']
  contradictions: Array<Record<string, unknown>>
  contextVariables?: Record<string, string>
  tokenCost?: number
  remainingTokens?: number
}

export interface InterviewStreamChunk {
  event: 'session' | 'meta' | 'chunk' | 'done'
  data: Record<string, unknown>
}

export interface GenerateReportPayload extends InsightReport {
  tokenCost?: number
  remainingTokens?: number
}

async function buildAuthHeaders(init?: RequestInit): Promise<HeadersInit> {
  const token = await authApi.getValidToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers ?? {}),
  }
}

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = await buildAuthHeaders(init)
  const response = await fetch(input, {
    ...init,
    headers,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const errorPayload = await response.clone().json() as { detail?: string; message?: string }
      detail = String(errorPayload.detail ?? errorPayload.message ?? '').trim()
    } catch {
      // ignore parse failure
    }
    throw new Error(`Request failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  return response.json() as Promise<T>
}

type GenericPayload<T> = { data?: T }

function normalizeSession(session: Partial<InterviewSession> & { payload?: Record<string, unknown> }): InterviewSession {
  const payload = session.payload ?? {}
  const stateContext = (session.stateContext as InterviewSession['stateContext'] | undefined) ?? (payload.stateContext as InterviewSession['stateContext'] | undefined)
  return {
    id: session.id ?? '',
    userId: session.userId ?? '',
    status: (session.status as InterviewSession['status']) ?? 'IN_PROGRESS',
    currentStage: (session.currentStage as InterviewSession['currentStage']) ?? 'DIVERGENT',
    turnCount: Number(session.turnCount ?? 0),
    maxTurns: Number(session.maxTurns ?? 30),
    contextVariables: (session.contextVariables as Record<string, string> | undefined) ?? (payload.contextVariables as Record<string, string> | undefined) ?? {},
    extractedContradictions: (session.extractedContradictions as InterviewSession['extractedContradictions'] | undefined) ?? (payload.contradictions as InterviewSession['extractedContradictions'] | undefined) ?? [],
    messages: (session.messages as InterviewSession['messages'] | undefined) ?? (payload.messages as InterviewSession['messages'] | undefined) ?? [],
    tokenConsumed: Number(session.tokenConsumed ?? payload.tokenConsumed ?? 0),
    stateContext,
    readiness: Boolean(session.readiness ?? stateContext?.readiness ?? payload.readiness ?? false),
    offTopicCount: Number(session.offTopicCount ?? stateContext?.offTopicCount ?? payload.offTopicCount ?? 0),
    badCaseFlags: (session.badCaseFlags as string[] | undefined) ?? (stateContext?.badCaseFlags ?? payload.badCaseFlags as string[] | undefined) ?? [],
    completionReason: (session.completionReason as string | null | undefined) ?? stateContext?.completionReason ?? (payload.completionReason as string | null | undefined) ?? null,
    createdAt: session.createdAt ?? new Date().toISOString(),
    updatedAt: session.updatedAt ?? new Date().toISOString(),
  }
}

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const payload = await readJson<GenericPayload<UserProfile>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/profiles/${userId}`)
  return payload.data ?? null
}

export async function fetchReports(userId: string, publicOnly = false): Promise<InsightReport[]> {
  const params = new URLSearchParams({ user_id: userId, public_only: String(publicOnly) })
  const payload = await readJson<GenericPayload<{ items?: InsightReport[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/reports?${params.toString()}`)
  return payload.data?.items ?? []
}

export async function fetchPublicReports(): Promise<InsightReport[]> {
  const params = new URLSearchParams({ public_only: 'true' })
  const payload = await readJson<GenericPayload<{ items?: InsightReport[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/reports?${params.toString()}`)
  return payload.data?.items ?? []
}

export async function fetchSessions(userId?: string): Promise<InterviewSession[]> {
  const params = new URLSearchParams()
  if (userId) {
    params.set('user_id', userId)
  }
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await readJson<GenericPayload<{ items?: InterviewSession[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/sessions${suffix}`)
  return (payload.data?.items ?? []).map(item => normalizeSession(item))
}

export async function fetchSessionById(sessionId: string): Promise<InterviewSession | null> {
  const payload = await readJson<GenericPayload<InterviewSession>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/sessions/${sessionId}`)
  return payload.data ? normalizeSession(payload.data) : null
}

export async function upsertSession(session: InterviewSession): Promise<InterviewSession> {
  const payload = await readJson<GenericPayload<InterviewSession>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/sessions/${session.id}`, {
    method: 'PUT',
    body: JSON.stringify(session),
  })
  return normalizeSession(payload.data ?? session)
}

export async function fetchRuntimeConfigs(): Promise<SystemConfig[]> {
  const payload = await readJson<GenericPayload<{ items?: SystemConfig[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/runtime/config`)
  return payload.data?.items ?? []
}

export async function updateRuntimeConfig(key: string, value: string, type?: SystemConfig['type']): Promise<SystemConfig | null> {
  const payload = await readJson<GenericPayload<SystemConfig>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/runtime/config/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value, type }),
  })
  return payload.data ?? null
}

function normalizeThread(thread: Partial<SocialThread>): SocialThread {
  return {
    id: thread.id ?? '',
    userIdA: thread.userIdA ?? '',
    userIdB: thread.userIdB ?? '',
    matchId: thread.matchId,
    unlockStage: Number(thread.unlockStage ?? 0) as SocialThread['unlockStage'],
    icebreakers: Array.isArray(thread.icebreakers) ? thread.icebreakers : [],
    tensionReport: thread.tensionReport ?? '',
    unlockMilestones: Array.isArray(thread.unlockMilestones) ? thread.unlockMilestones : [],
    messages: Array.isArray(thread.messages) ? thread.messages : [],
    unlockState: thread.unlockState,
    stagePolicy: thread.stagePolicy,
    tensionHandbook: thread.tensionHandbook,
    contactExchangeStatus: thread.contactExchangeStatus,
    createdAt: thread.createdAt ?? new Date().toISOString(),
    updatedAt: thread.updatedAt ?? new Date().toISOString(),
  }
}

export async function fetchThreads(userId?: string): Promise<SocialThread[]> {
  const params = new URLSearchParams()
  if (userId) params.set('user_id', userId)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await readJson<GenericPayload<{ items?: SocialThread[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/threads${suffix}`)
  return (payload.data?.items ?? []).map(item => normalizeThread(item))
}

export async function fetchStrategyAssets(assetKey?: string): Promise<StrategyAsset[]> {
  const params = new URLSearchParams()
  if (assetKey) params.set('asset_key', assetKey)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await readJson<GenericPayload<{ items?: StrategyAsset[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/runtime/strategy-assets${suffix}`)
  return payload.data?.items ?? []
}

export async function fetchActiveStrategyAsset(assetKey: string): Promise<StrategyAsset | null> {
  const payload = await readJson<GenericPayload<StrategyAsset>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/runtime/strategy-assets/${assetKey}/active`)
  return payload.data ?? null
}

export async function activateStrategyAsset(assetKey: string, version: string): Promise<StrategyAsset | null> {
  const payload = await readJson<GenericPayload<StrategyAsset>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/runtime/strategy-assets/${assetKey}/activate`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
  return payload.data ?? null
}

export async function fetchThreadById(threadId: string): Promise<SocialThread | null> {
  const payload = await readJson<GenericPayload<SocialThread>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/threads/${threadId}`)
  return payload.data ? normalizeThread(payload.data) : null
}

export async function upsertThread(thread: SocialThread): Promise<SocialThread> {
  const payload = await readJson<GenericPayload<SocialThread>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/threads/${thread.id}`, {
    method: 'PUT',
    body: JSON.stringify(thread),
  })
  return normalizeThread(payload.data ?? thread)
}

export async function fetchReportById(reportId: string): Promise<InsightReport | null> {
  const payload = await readJson<GenericPayload<InsightReport>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/reports/${reportId}`)
  return payload.data ?? null
}

export async function updateReportPublicState(reportId: string, isPublic: boolean): Promise<InsightReport | null> {
  const payload = await readJson<GenericPayload<InsightReport>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/reports/${reportId}/public`, {
    method: 'PATCH',
    body: JSON.stringify({ isPublic }),
  })
  return payload.data ?? null
}

export async function fetchAllProfiles(): Promise<UserProfile[]> {
  const payload = await readJson<GenericPayload<{ items?: UserProfile[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/profiles`)
  return payload.data?.items ?? []
}

export async function updateProfile(profileId: string, patch: Partial<UserProfile>): Promise<UserProfile | null> {
  const payload = await readJson<GenericPayload<UserProfile>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/profiles/${profileId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return payload.data ?? null
}

export async function fetchExposureLogs(userId?: string, date?: string): Promise<ExposureLogSummary[]> {
  const params = new URLSearchParams()
  if (userId) params.set('user_id', userId)
  if (date) params.set('date', date)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await readJson<GenericPayload<{ items?: ExposureLogSummary[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/exposure-logs${suffix}`)
  return payload.data?.items ?? []
}

export async function fetchDiscoveryCards(userId: string): Promise<DiscoveryCard[]> {
  const payload = await readJson<GenericPayload<{ items?: DiscoveryCard[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/match/discover`, {
    method: 'POST',
    body: JSON.stringify({ userId, action: 'discover' }),
  })
  return payload.data?.items ?? []
}

export async function createDeepMatch(userId: string, targetReportId: string): Promise<MatchRecord & MatchAnalysisPayload> {
  const payload = await readJson<GenericPayload<MatchRecord & MatchAnalysisPayload>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/match/deep`, {
    method: 'POST',
    body: JSON.stringify({ userId, targetReportId, action: 'deep_match' }),
  })
  return (payload.data ?? {}) as MatchRecord & MatchAnalysisPayload
}

export async function generateIcebreakers(userId: string, threadId: string, matchId: string): Promise<IcebreakersPayload> {
  const payload = await readJson<GenericPayload<IcebreakersPayload>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/match/icebreakers`, {
    method: 'POST',
    body: JSON.stringify({ userId, threadId, matchId, action: 'generate_icebreakers' }),
  })
  return payload.data ?? { items: [], icebreakers: [] }
}

export async function fetchMatches(userId?: string): Promise<MatchRecord[]> {
  const params = new URLSearchParams()
  if (userId) params.set('user_id', userId)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await readJson<GenericPayload<{ items?: MatchRecord[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/matches${suffix}`)
  return payload.data?.items ?? []
}

export async function createInterviewTurn(input: {
  sessionId?: string
  userId: string
  userMessage: string
  messages: Array<Record<string, unknown>>
  currentStage: string
  turnCount: number
  maxTurns: number
}): Promise<InterviewTurnPayload> {
  const payload = await readJson<GenericPayload<InterviewTurnPayload>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/interview/turn`, {
    method: 'POST',
    body: JSON.stringify({ ...input, action: 'interview_turn' }),
  })
  return (payload.data ?? {}) as InterviewTurnPayload
}

export async function createInterviewTurnStream(
  input: {
    sessionId?: string
    userId: string
    userMessage: string
    messages: Array<Record<string, unknown>>
    currentStage: string
    turnCount: number
    maxTurns: number
  },
  handlers: { onEvent?: (chunk: InterviewStreamChunk) => void } = {},
): Promise<InterviewTurnPayload> {
  const headers = await buildAuthHeaders()
  const response = await fetch(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/interview/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...input, action: 'interview_stream' }),
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload: InterviewTurnPayload | null = null

  if (!reader) {
    throw new Error('Streaming not supported')
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const lines = part.split('\n')
      let eventName = 'message'
      let dataLine = ''
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.replace('event:', '').trim()
        if (line.startsWith('data:')) dataLine = line.replace('data:', '').trim()
      }
      if (!dataLine) continue
      const parsed = JSON.parse(dataLine) as Record<string, unknown>
      handlers.onEvent?.({ event: eventName as InterviewStreamChunk['event'], data: parsed })
      if (eventName === 'done') {
        finalPayload = parsed as unknown as InterviewTurnPayload
      }
    }
  }

  if (!finalPayload) {
    throw new Error('Streaming finished without final payload')
  }
  return finalPayload
}

export async function createReport(input: {
  sessionId: string
  userId: string
  messages: Array<Record<string, unknown>>
}): Promise<GenerateReportPayload> {
  const payload = await readJson<GenericPayload<GenerateReportPayload>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/report/generate`, {
    method: 'POST',
    body: JSON.stringify({ ...input, action: 'generate_report' }),
  })
  return (payload.data ?? {}) as GenerateReportPayload
}

export async function createReportJob(input: {
  sessionId: string
  userId: string
  messages: Array<Record<string, unknown>>
}): Promise<ReportJob> {
  const payload = await readJson<GenericPayload<ReportJob>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/report/jobs`, {
    method: 'POST',
    body: JSON.stringify({ ...input, action: 'generate_report_async' }),
  })
  return (payload.data ?? {}) as ReportJob
}

export async function fetchReportJob(jobId: string): Promise<ReportJob | null> {
  const payload = await readJson<GenericPayload<ReportJob>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/report/jobs/${jobId}`)
  return payload.data ?? null
}

export async function fetchReportJobs(userId?: string): Promise<ReportJob[]> {
  const params = new URLSearchParams()
  if (userId) params.set('user_id', userId)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await readJson<GenericPayload<{ items?: ReportJob[] }>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/report/jobs${suffix}`)
  return payload.data?.items ?? []
}

export async function fetchRuntimeStats(): Promise<RuntimeStats> {
  const payload = await readJson<GenericPayload<RuntimeStats>>(`${getRuntimeApiBaseUrl()}/api/v1/ariadne/runtime/stats`)
  return payload.data ?? { users: 0, sessions: 0, reports: 0, matches: 0, todayExposures: 0 }
}