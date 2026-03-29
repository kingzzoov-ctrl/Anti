# Ariadne Backend

## 启动

1. 复制 `backend/.env.example` 为 `.env` 并按需修改。
2. 在仓库根目录执行容器编排，启动 PostgreSQL、Redis 和 FastAPI。
3. 后端默认暴露 `http://localhost:8000`。

## 当前能力

- SSE 问询流：`POST /api/v1/ariadne/interview/stream`
- 问询会话持久化：PostgreSQL + Redis session cache
- 异步报告任务骨架：`POST /api/v1/ariadne/report/jobs`
- 报告任务查询：`GET /api/v1/ariadne/report/jobs`、`GET /api/v1/ariadne/report/jobs/{job_id}`
- 通知 inbox 基础分发：报告完成后写入用户通知载荷
- Runtime config 热切换：支持 Admin 动态更新
- Alembic 初始化目录：`backend/alembic/`

## 测试

- 后端测试位于 `backend/tests/`
- 建议先安装 `backend/requirements.txt` 中依赖，再执行 `pytest`
- 当前已覆盖：
	- 通知事件构建与 inbox 裁剪
	- runtime config 基础类型收敛

## 当前接口

- `GET /healthz`
- `GET /api/v1/ariadne/status`
- `GET /api/v1/ariadne/runtime/config`
- `GET /api/v1/ariadne/profiles/{user_id}`
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

当前版本已按 `总清单.txt` 建立 FastAPI + PostgreSQL(pgvector) + Redis + Docker 的基础骨架，并补齐了 SSE 问询接口、报告任务流水线骨架、通知 inbox 基础、隐私确认前端链路与 Alembic 初始化目录。

当前仍未完全收口的部分包括：

- 真正独立后台 worker / 队列执行器
- 更完整的多通道外发通知发送器
- 向量引擎多后端热切换
- 更系统的集成测试与迁移回放策略
