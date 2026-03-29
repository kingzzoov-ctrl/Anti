from __future__ import annotations

from redis import Redis

from app.core.config import get_settings

TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local delta = math.max(0, now - ts)
local replenished = math.min(capacity, tokens + (delta * refill))
local allowed = replenished >= requested
local new_tokens = replenished
if allowed then
  new_tokens = replenished - requested
end

redis.call('HMSET', key, 'tokens', new_tokens, 'ts', now)
redis.call('EXPIRE', key, 60)

if allowed then
  return {1, new_tokens}
else
  return {0, new_tokens}
end
"""

TOKEN_BALANCE_LUA = """
local key = KEYS[1]
local initialized = redis.call('EXISTS', key)
if initialized == 0 then
  redis.call('SET', key, ARGV[1])
end

local current_balance = tonumber(redis.call('GET', key) or '0')
local cost = tonumber(ARGV[2])
local min_balance = tonumber(ARGV[3])

if current_balance - cost >= min_balance then
  local remaining = current_balance - cost
  redis.call('SET', key, remaining)
  redis.call('EXPIRE', key, 86400)
  return {1, remaining}
end

redis.call('EXPIRE', key, 86400)
return {0, current_balance}
"""


def get_client() -> Redis:
    settings = get_settings()
    return Redis.from_url(settings.redis_url, decode_responses=True)


def consume(bucket: str, capacity: int = 30, refill_per_second: int = 1, requested: int = 1) -> tuple[bool, float]:
    client = get_client()
    now = __import__('time').time()
    allowed, remaining = client.eval(TOKEN_BUCKET_LUA, 1, bucket, capacity, refill_per_second, now, requested)
    return bool(int(allowed)), float(remaining)


def consume_token_balance(balance_key: str, current_balance: float, cost: float, min_balance: float = 0) -> tuple[bool, float]:
  client = get_client()
  allowed, remaining = client.eval(TOKEN_BALANCE_LUA, 1, balance_key, float(current_balance), float(cost), float(min_balance))
  return bool(int(allowed)), float(remaining)
