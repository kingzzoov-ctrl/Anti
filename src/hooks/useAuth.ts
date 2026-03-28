import { useState, useEffect } from 'react'
import { blink } from '../blink/client'

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
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user ? {
        id: state.user.id,
        email: state.user.email,
        displayName: state.user.displayName,
      } : null)
      if (!state.isLoading) setIsLoading(false)
    })
    return unsubscribe
  }, [])

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  }
}
