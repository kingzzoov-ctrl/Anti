import { authApi } from './localApi'

export function requireAuthenticatedUser() {
  if (!authApi.isAuthenticated()) {
    authApi.login()
    return false
  }
  return true
}

export function startLogin() {
  authApi.login()
}

export function signOut() {
  authApi.logout()
}
