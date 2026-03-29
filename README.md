# Ariadne

Ariadne 是一个围绕“深度问询 → 洞察报告 → 匹配推演 → 治理闭环”构建的 Web 决策引擎原型工程。

## 当前工程结构

- `src/`：前端 Vite + React + TypeScript 应用
- `backend/`：FastAPI + PostgreSQL(pgvector) + Redis 服务
- `functions/`：历史 serverless 废弃链路保留区
- `Ariadne基座/`：方法论、知识与技能基座

## 已落地能力

- 阶段式问询主链路
- SSE 问询流接口
- 洞察报告生成与版本演进
- Discovery / Deep Match / Thread 阶梯解锁
- Runtime config 热切换
- Admin 治理台、通知 inbox、通知队列治理、死信重放、bad-case 回放导出
- Lab 隐私告知确认与 transcript 导出
- Lab 隐私告知确认持久化、后端同步与 transcript 导出
- 报告任务后台轮询 worker
- 独立可运行的报告 worker 脚本
- 通知持久化队列、重试与独立通知 worker
- 通知幂等、死信与 tier 路由
- Admin 通知治理与死信重放
- Free 周报摘要通知骨架（weekly digest）
- 社交带宽限流与超限自动隐身（discover 匹配池）
- Thread 治理状态（`active` / `cooldown` / `closed`）与前端只读提示
- Ad-Reward 任务换 Token 后端骨架
- 向量召回引擎热切换（`pgvector` / `memory` / `hybrid`）
- Prompt / 策略资产激活来源与回滚审计留痕
- 多通道通知发送骨架
- Alembic 初始化骨架
- 前端通知治理界面已接入，且本轮 `npm run build` 构建通过
- 后端线程治理与策略审计测试已通过（`backend/tests/test_social_bandwidth.py`, `backend/tests/test_strategy_asset_audit.py`）
- 后端 Ariadne API 治理测试已补齐并通过（`backend/tests/test_ariadne_api_governance.py`）
- 后端异步链路 API 测试已扩展到通知列表 / 死信重放 / 报告任务查询，并与治理测试一起通过（当前相关 pytest 共 `18 passed`）
- 后端初始化已收敛到 `backend/app/main.py` 的 `lifespan`，移除了路由层 startup 弃用告警来源
- `backend/app/services/interview_engine.py` 已清理已确认的 `datetime.utcnow()` 报告时间戳写法，统一改为 UTC aware 时间生成

## 本地脚本

### 前端

- `npm run dev`：启动前端开发环境
- `npm run build`：构建前端
- `npm run test`：运行前端单测
- `npm run lint`：运行类型、样式与 CSS 校验

### 后端

- 依赖见 `backend/requirements.txt`
- 测试命令：`pytest`

## 当前仍待继续补齐

- 真正外部队列系统 / 多副本消费治理
- 多通道外发通知发送器完善与真实供应商接入
- 向量引擎多后端抽象
- 更完整的 API / 集成测试（虽已补到异步链路查询与通知重放，但覆盖仍未到全量集成级）
- 与总清单要求的 Next.js 架构对齐