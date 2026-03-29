type Primitive = string | number | boolean | null | undefined
export type RecordValue = Primitive | Primitive[] | Record<string, unknown>
export type DataRecord = Record<string, RecordValue>

export type QueryWhere = Record<string, unknown> & {
  OR?: QueryWhere[]
}

export type ListOptions = {
  where?: QueryWhere
  orderBy?: Record<string, 'asc' | 'desc'>
  limit?: number
}

export type CollectionName =
  | 'systemConfigs'
  | 'interviewSessions'
  | 'insightReports'
  | 'matchRecords'
  | 'userProfiles'
  | 'exposureLogs'
  | 'socialThreads'

const STORAGE_PREFIX = 'ariadne.localdb'

const seededConfigs = [
  { key: 'PROMPT_VERSION_INTERVIEW', value: '1', type: 'int', description: 'Interview prompt version' },
  { key: 'PROMPT_VERSION_REPORT', value: '1', type: 'int', description: 'Report prompt version' },
  { key: 'PROMPT_VERSION_MATCH', value: '1', type: 'int', description: 'Match prompt version' },
  { key: 'TOKEN_COST_DEEP_MATCH', value: '50', type: 'int', description: 'Deep match token cost' },
  { key: 'MATCH_DECAY_FACTOR', value: '0.05', type: 'float', description: 'Exposure decay factor' },
  { key: 'MATCH_RESONANCE_THRESHOLD', value: '0.55', type: 'float', description: 'Minimum resonance threshold' },
  { key: 'CONSISTENCY_MIN_THRESHOLD', value: '0.6', type: 'float', description: 'Minimum consistency threshold' },
  { key: 'RUNTIME_FN_INTERVIEW_URL', value: '', type: 'string', description: 'Interview runtime function url' },
  { key: 'RUNTIME_FN_MATCH_URL', value: '', type: 'string', description: 'Match runtime function url' },
] as const

function collectionKey(name: CollectionName) {
  return `${STORAGE_PREFIX}.${name}`
}

export function readCollection(name: CollectionName): DataRecord[] {
  try {
    const raw = localStorage.getItem(collectionKey(name))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeCollection(name: CollectionName, records: DataRecord[]) {
  localStorage.setItem(collectionKey(name), JSON.stringify(records))
}

export function ensureSeedData() {
  const existing = readCollection('systemConfigs')
  if (existing.length > 0) return

  const now = new Date().toISOString()
  const initial = seededConfigs.map((item) => ({
    ...item,
    id: item.key,
    updatedAt: now,
  }))
  writeCollection('systemConfigs', initial)
}

function normalizeComparable(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

function matchesWhere(record: DataRecord, where?: QueryWhere): boolean {
  if (!where) return true

  const { OR, ...rest } = where

  const baseMatch = Object.entries(rest).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      return JSON.stringify(record[key]) === JSON.stringify(expected)
    }
    return normalizeComparable(record[key]) === normalizeComparable(expected)
  })

  if (!baseMatch) return false
  if (!OR || OR.length === 0) return true
  return OR.some((condition) => matchesWhere(record, condition))
}

function sortRecords(records: DataRecord[], orderBy?: Record<string, 'asc' | 'desc'>) {
  if (!orderBy) return records
  const [[key, direction]] = Object.entries(orderBy)
  return [...records].sort((a, b) => {
    const av = normalizeComparable(a[key])
    const bv = normalizeComparable(b[key])
    if (av === bv) return 0
    const comparison = av > bv ? 1 : -1
    return direction === 'desc' ? comparison * -1 : comparison
  })
}

export function createCollectionApi(name: CollectionName) {
  return {
    async list(options: ListOptions = {}) {
      const filtered = readCollection(name).filter((item) => matchesWhere(item, options.where))
      const sorted = sortRecords(filtered, options.orderBy)
      return typeof options.limit === 'number' ? sorted.slice(0, options.limit) : sorted
    },
    async get(id: string) {
      return readCollection(name).find((item) => normalizeComparable(item.id) === normalizeComparable(id)) ?? null
    },
    async create(payload: DataRecord) {
      const records = readCollection(name)
      const now = new Date().toISOString()
      const record = {
        createdAt: now,
        updatedAt: now,
        ...payload,
      }
      records.push(record)
      writeCollection(name, records)
      return record
    },
    async update(id: string, payload: DataRecord) {
      const records = readCollection(name)
      const index = records.findIndex((item) => normalizeComparable(item.id) === normalizeComparable(id))
      if (index < 0) throw new Error(`Record not found: ${name}/${id}`)
      const updated = {
        ...records[index],
        ...payload,
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      }
      records[index] = updated
      writeCollection(name, records)
      return updated
    },
    async count(options: { where?: QueryWhere } = {}) {
      return readCollection(name).filter((item) => matchesWhere(item, options.where)).length
    },
  }
}

ensureSeedData()

export const localDb = {
  systemConfigs: createCollectionApi('systemConfigs'),
  interviewSessions: createCollectionApi('interviewSessions'),
  insightReports: createCollectionApi('insightReports'),
  matchRecords: createCollectionApi('matchRecords'),
  userProfiles: createCollectionApi('userProfiles'),
  exposureLogs: createCollectionApi('exposureLogs'),
  socialThreads: createCollectionApi('socialThreads'),
}
