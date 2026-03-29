# Ariadne Backend

## 启动

1. 复制 `backend/.env.example` 为 `.env` 并按需修改。
2. 在仓库根目录执行容器编排，启动 PostgreSQL、Redis 和 FastAPI。
3. 后端默认暴露 `http://localhost:8000`。

## 当前能力

- SSE 问询流：`POST /api/v1/ariadne/interview/stream`
- 问询会话持久化：PostgreSQL + Redis session cache
- 异步报告任务骨架：`POST /api/v1/ariadne/report/jobs`
- 后台轮询 worker：FastAPI 进程内 daemon worker 自动认领 `queued` 报告任务
- 独立 worker 入口：`backend/scripts/run_report_worker.py`
- 独立通知 worker 入口：`backend/scripts/run_notification_worker.py`
- 多通道通知发送骨架：支持 `inbox` / `email` / `telegram` / `wechat`
- 通知队列与重试：`notification_events` 持久化队列 + 失败退避重试
- 通知幂等与死信：支持 `idempotency_key` 去重与最终失败留痕
- tier 路由通知：按 `Free / Ad-Reward / Premium` 选择触达通道
- 通知治理接口：支持通知列表查询、死信查看与手动重放
- Free 周报摘要骨架：支持按最近窗口汇总 inbox/通知事件并生成 `weekly_digest`
- 隐私告知确认持久化：支持按用户记录 `privacyConsent`，并提供查询/确认 API
- 社交带宽限流：支持按 `SOCIAL_ACTIVE_THREAD_LIMIT` 计算 `socialBandwidth`，并在 `/match/discover` 中拦截超限用户、过滤已饱和候选
- Ad-Reward 骨架：支持激励任务目录、任务领取记录与 Token 发放，领取后可将用户升级为 `Ad-Reward` tier
- 向量引擎热切换：支持通过 `VECTOR_SEARCH_ENGINE` 在 `pgvector`、纯内存召回与 hybrid 合并召回间切换
- 报告任务查询：`GET /api/v1/ariadne/report/jobs`、`GET /api/v1/ariadne/report/jobs/{job_id}`
- 通知 inbox 基础分发：报告完成后写入用户通知载荷
- Runtime config 热切换：支持 Admin 动态更新
- Alembic 初始化目录：`backend/alembic/`

## 测试

- 后端测试位于 `backend/tests/`
- 建议先安装 `backend/requirements.txt` 中依赖，再执行 `pytest`
- 当前已覆盖：
	- 通知事件构建与 inbox 裁剪
	- 通知分发状态机
	- 通知队列认领、重试与 worker 循环
	- tier 路由与死信留痕
	- weekly digest 摘要生成骨架
	- 社交带宽快照与 discover 超限拦截
	- Ad-Reward 任务目录与 Token 发放骨架
	- 向量召回引擎热切换与回退
	- runtime config 基础类型收敛
	- report worker 循环

## 当前接口

- `GET /healthz`
- `GET /api/v1/ariadne/status`
- `GET /api/v1/ariadne/runtime/config`
	- 隐私告知确认持久化与序列化
- `GET /api/v1/ariadne/profiles/{user_id}`
- `GET /api/v1/ariadne/profiles/{user_id}/privacy-consent`
- `POST /api/v1/ariadne/profiles/{user_id}/privacy-consent`
- `GET /api/v1/ariadne/sessions?user_id={id}`
- `POST /api/v1/ariadne/interview/turn`
- `POST /api/v1/ariadne/interview/stream`
- `POST /api/v1/ariadne/report/generate`
- `POST /api/v1/ariadne/report/jobs`
- `GET /api/v1/ariadne/report/jobs`
- `GET /api/v1/ariadne/report/jobs/{job_id}`
- `GET /api/v1/ariadne/reports?user_id={id}`
- `POST /api/v1/ariadne/match/discover`
- `POST /api/v1/ariadne/match/deep`
- `POST /api/v1/ariadne/match/icebreakers`

## 说明

当前版本已按 `总清单.txt` 建立 FastAPI + PostgreSQL(pgvector) + Redis + Docker 的基础骨架，并补齐了 SSE 问询接口、报告任务流水线骨架、进程内后台 worker、通知持久化队列与重试、隐私确认前端链路与 Alembic 初始化目录。

当前仍未完全收口的部分包括：

- 真正外部队列 / 多副本消费协调
- 更完整的多通道外发通知发送器（当前仍为 webhook 骨架）
- 向量引擎多后端热切换
- 更系统的集成测试与迁移回放策略
