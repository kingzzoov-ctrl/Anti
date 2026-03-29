import { useState, useEffect } from 'react'
import { authApi } from '../lib/localApi'

interface AuthUser {
  id: string
  email?: string
  displayName?: string
}

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = authApi.subscribeAuthState((state) => {
      setUser(state.user ? {
        id: state.user.id,
        email: state.user.email,
        displayName: state.user.displayName,
      } : null)
      setIsLoading(Boolean(state.isLoading))
    })
    return unsubscribe
  }, [])

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  }
}
