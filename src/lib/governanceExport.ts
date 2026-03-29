import type { InterviewSession, Message, SessionStage } from '../types'

interface TranscriptExportInput {
  sessionId: string
  stage: SessionStage
  turnCount: number
  readiness: boolean
  badCaseFlags: string[]
  messages: Message[]
}

export function buildTranscriptMarkdown(input: TranscriptExportInput): string {
  return [
    '# Ariadne Interview Transcript',
    '',
    `- sessionId: ${input.sessionId}`,
    `- stage: ${input.stage}`,
    `- turnCount: ${input.turnCount}`,
    `- readiness: ${String(input.readiness)}`,
    `- badCaseFlags: ${input.badCaseFlags.join(', ') || 'none'}`,
    '',
    '## Messages',
    ...input.messages
      .filter(message => message.role !== 'system')
      .map(message => `### ${message.role.toUpperCase()} [${message.stage}]\n${message.content}\n`),
  ].join('\n')
}

export function buildSessionReplayMarkdown(session: InterviewSession): string {
  return [
    `# Session Replay ${session.id}`,
    '',
    `- status: ${session.status}`,
    `- stage: ${session.currentStage}`,
    `- turnCount: ${session.turnCount}`,
    `- readiness: ${String(session.readiness ?? false)}`,
    `- completionReason: ${session.completionReason ?? 'none'}`,
    `- badCaseFlags: ${(session.badCaseFlags ?? []).join(', ') || 'none'}`,
    '',
    '## Messages',
    ...(session.messages ?? [])
      .filter(message => message.role !== 'system')
      .map(message => `### ${message.role.toUpperCase()} [${message.stage}]\n${message.content}\n`),
  ].join('\n')
}
