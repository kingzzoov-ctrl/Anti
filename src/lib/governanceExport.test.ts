import { describe, expect, it } from 'vitest'
import { buildSessionReplayMarkdown, buildTranscriptMarkdown } from './governanceExport'
import type { InterviewSession } from '../types'

describe('governanceExport', () => {
  it('builds transcript markdown with key governance fields', () => {
    const markdown = buildTranscriptMarkdown({
      sessionId: 'sess_123456',
      stage: 'PRESS',
      turnCount: 7,
      readiness: false,
      badCaseFlags: ['off_topic'],
      messages: [
        { role: 'user', stage: 'DIVERGENT', content: 'hello' },
        { role: 'ai', stage: 'PRESS', content: 'why?' },
      ],
    })

    expect(markdown).toContain('# Ariadne Interview Transcript')
    expect(markdown).toContain('- sessionId: sess_123456')
    expect(markdown).toContain('- badCaseFlags: off_topic')
    expect(markdown).toContain('### USER [DIVERGENT]')
    expect(markdown).toContain('### AI [PRESS]')
  })

  it('builds session replay markdown', () => {
    const session: InterviewSession = {
      id: 'sess_replay',
      userId: 'user_1',
      status: 'COMPLETED',
      currentStage: 'COMPLETE',
      turnCount: 18,
      maxTurns: 30,
      contextVariables: {},
      extractedContradictions: [],
      messages: [
        { role: 'user', stage: 'CONVERGE', content: 'final answer' },
        { role: 'ai', stage: 'COMPLETE', content: 'done' },
      ],
      tokenConsumed: 12,
      readiness: true,
      badCaseFlags: ['manual_review'],
      completionReason: 'report_ready',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    }

    const markdown = buildSessionReplayMarkdown(session)
    expect(markdown).toContain('# Session Replay sess_replay')
    expect(markdown).toContain('- completionReason: report_ready')
    expect(markdown).toContain('### USER [CONVERGE]')
    expect(markdown).toContain('### AI [COMPLETE]')
  })
})
