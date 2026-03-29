import type { UserProfile, UserTier } from '../types'

export const DEFAULT_PROFILE_CONFIG = {
  initialTokenBalance: 100,
  matchingEnabled: true,
  tier: 'Free' as UserTier,
  isAdmin: false,
}

export function parseUserProfile(raw: Record<string, unknown>): UserProfile {
  const privacyConsentRaw = raw.privacyConsent && typeof raw.privacyConsent === 'object'
    ? raw.privacyConsent as Record<string, unknown>
    : {}
  return {
    id: String(raw.id ?? ''),
    userId: String(raw.userId ?? ''),
    displayName: raw.displayName ? String(raw.displayName) : undefined,
    tier: (raw.tier as UserTier) || DEFAULT_PROFILE_CONFIG.tier,
    tokenBalance: Number(raw.tokenBalance) || 0,
    notificationChannels: parseJsonRecord(raw.notificationChannels),
    matchingEnabled: Number(raw.matchingEnabled) > 0,
    privacyConsent: {
      accepted: Boolean(privacyConsentRaw.accepted),
      acceptedAt: privacyConsentRaw.acceptedAt ? String(privacyConsentRaw.acceptedAt) : null,
      version: privacyConsentRaw.version ? String(privacyConsentRaw.version) : null,
      scope: privacyConsentRaw.scope ? String(privacyConsentRaw.scope) : null,
    },
    isAdmin: Number(raw.isAdmin) > 0,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  }
}

export function buildDefaultProfile(userId: string) {
  return {
    id: `prof_${userId}_${Date.now()}`,
    userId,
    tier: DEFAULT_PROFILE_CONFIG.tier,
    tokenBalance: String(DEFAULT_PROFILE_CONFIG.initialTokenBalance),
    notificationChannels: '{}',
    matchingEnabled: DEFAULT_PROFILE_CONFIG.matchingEnabled ? '1' : '0',
    isAdmin: DEFAULT_PROFILE_CONFIG.isAdmin ? '1' : '0',
  }
}

function parseJsonRecord(value: unknown): Record<string, string[]> {
  try {
    if (typeof value !== 'string') return {}
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string[]> : {}
  } catch {
    return {}
  }
}
