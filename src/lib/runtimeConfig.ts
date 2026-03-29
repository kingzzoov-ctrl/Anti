export type RuntimeFunctionKey = 'interview' | 'match'

function resolveApiBaseUrl() {
  const envBase = import.meta.env.VITE_ARIADNE_API_BASE_URL?.trim()
  if (envBase) return envBase.replace(/\/$/, '')
  return 'http://localhost:8000'
}

export function getRuntimeApiBaseUrl() {
  return resolveApiBaseUrl()
}

const FUNCTION_CONFIG_KEYS: Record<RuntimeFunctionKey, string> = {
  interview: 'RUNTIME_FN_INTERVIEW_URL',
  match: 'RUNTIME_FN_MATCH_URL',
}

const FUNCTION_ENV_KEYS: Record<RuntimeFunctionKey, string | undefined> = {
  interview: import.meta.env.VITE_ARIADNE_INTERVIEW_FN_URL,
  match: import.meta.env.VITE_ARIADNE_MATCH_FN_URL,
}

export const RUNTIME_CONFIG_KEYS = FUNCTION_CONFIG_KEYS

export function getRuntimeFunctionEnvName(key: RuntimeFunctionKey) {
  return key === 'interview' ? 'VITE_ARIADNE_INTERVIEW_FN_URL' : 'VITE_ARIADNE_MATCH_FN_URL'
}

export function getRuntimeApiBaseEnvName() {
  return 'VITE_ARIADNE_API_BASE_URL'
}
