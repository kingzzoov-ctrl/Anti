import { localAuth } from './localAuth'
import { localDb } from './localDb'

export const authApi = localAuth
export const db = localDb

export const localApi = {
  auth: authApi,
  db,
}
