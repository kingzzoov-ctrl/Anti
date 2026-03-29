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
- Admin 治理台、通知 inbox、bad-case 回放导出
- Lab 隐私告知确认与 transcript 导出
- Alembic 初始化骨架

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

- 真正后台异步 worker
- 多通道外发通知发送器
- 向量引擎多后端抽象
- 更完整的集成测试
- 与总清单要求的 Next.js 架构对齐