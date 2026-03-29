export interface LocalAuthUser {
  id: string
  email?: string
  displayName?: string
}

export interface LocalAuthState {
  user: LocalAuthUser | null
  isLoading: boolean
}

type AuthListener = (state: LocalAuthState) => void

const AUTH_STORAGE_KEY = 'ariadne.auth.user'
const subscribers = new Set<AuthListener>()

function readUser(): LocalAuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as LocalAuthUser
  } catch {
    return null
  }
}

function emit() {
  const state: LocalAuthState = {
    user: readUser(),
    isLoading: false,
  }
  subscribers.forEach((listener) => listener(state))
}

export function subscribeAuthState(listener: AuthListener) {
  subscribers.add(listener)
  listener({ user: readUser(), isLoading: false })
  return () => subscribers.delete(listener)
}

export function getCurrentUser() {
  return readUser()
}

export function isAuthenticated() {
  return !!readUser()
}

export function login() {
  const current = readUser()
  if (current) {
    emit()
    return current
  }

  const user: LocalAuthUser = {
    id: 'local-user',
    email: 'local@ariadne.dev',
    displayName: 'Local User',
  }

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user))
  emit()
  return user
}

export function logout() {
  localStorage.removeItem(AUTH_STORAGE_KEY)
  emit()
}

export async function getValidToken() {
  return 'local-dev-token'
}

export const localAuth = {
  subscribeAuthState,
  getCurrentUser,
  isAuthenticated,
  login,
  logout,
  getValidToken,
}
