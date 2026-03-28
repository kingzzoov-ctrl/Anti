import { useState, useEffect, useCallback } from 'react'
import { blink } from '../blink/client'
import type { UserProfile, UserTier } from '../types'

export function useUserProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchProfile = useCallback(async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      const profiles = await blink.db.userProfiles.list({
        where: { userId },
        limit: 1,
      })
      if (profiles.length > 0) {
        const p = profiles[0] as Record<string, unknown>
        setProfile({
          id: p.id as string,
          userId: p.userId as string,
          displayName: p.displayName as string | undefined,
          tier: (p.tier as UserTier) || 'Free',
          tokenBalance: Number(p.tokenBalance) || 0,
          notificationChannels: JSON.parse((p.notificationChannels as string) || '{}'),
          matchingEnabled: Number(p.matchingEnabled) > 0,
          isAdmin: Number(p.isAdmin) > 0,
          createdAt: p.createdAt as string,
          updatedAt: p.updatedAt as string,
        })
      } else {
        // Create default profile
        const newProfile = await blink.db.userProfiles.create({
          id: `prof_${userId}_${Date.now()}`,
          userId,
          tier: 'Free',
          tokenBalance: '100',
          notificationChannels: '{}',
          matchingEnabled: '1',
          isAdmin: '0',
        })
        const np = newProfile as Record<string, unknown>
        setProfile({
          id: np.id as string,
          userId: np.userId as string,
          tier: 'Free',
          tokenBalance: 100,
          notificationChannels: {},
          matchingEnabled: true,
          isAdmin: false,
          createdAt: np.createdAt as string,
          updatedAt: np.updatedAt as string,
        })
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const deductTokens = useCallback(async (amount: number): Promise<boolean> => {
    if (!profile) return false
    if (profile.tokenBalance < amount) return false
    const newBalance = profile.tokenBalance - amount
    await blink.db.userProfiles.update(profile.id, {
      tokenBalance: String(newBalance),
      updatedAt: new Date().toISOString(),
    })
    setProfile(prev => prev ? { ...prev, tokenBalance: newBalance } : null)
    return true
  }, [profile])

  const toggleMatching = useCallback(async () => {
    if (!profile) return
    const newVal = !profile.matchingEnabled
    await blink.db.userProfiles.update(profile.id, {
      matchingEnabled: newVal ? '1' : '0',
      updatedAt: new Date().toISOString(),
    })
    setProfile(prev => prev ? { ...prev, matchingEnabled: newVal } : null)
  }, [profile])

  return { profile, isLoading, refetch: fetchProfile, deductTokens, toggleMatching }
}
