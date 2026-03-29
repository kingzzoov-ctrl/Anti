import { useState, useEffect, useCallback } from 'react'
import type { UserProfile } from '../types'
import { buildDefaultProfile, parseUserProfile } from '../lib/userProfile'
import { fetchProfile as fetchProfileRemote, updateProfile } from '../lib/ariadneApi'

export function useUserProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchProfile = useCallback(async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      const remoteProfile = await fetchProfileRemote(userId)
      if (remoteProfile) {
        setProfile(parseUserProfile(remoteProfile as unknown as Record<string, unknown>))
      } else {
        setProfile(parseUserProfile(buildDefaultProfile(userId) as unknown as Record<string, unknown>))
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

  const toggleMatching = useCallback(async () => {
    if (!profile) return
    const newVal = !profile.matchingEnabled
    await updateProfile(profile.id, {
      matchingEnabled: newVal,
    })
    setProfile(prev => prev ? { ...prev, matchingEnabled: newVal } : null)
  }, [profile])

  return { profile, isLoading, refetch: fetchProfile, toggleMatching }
}
