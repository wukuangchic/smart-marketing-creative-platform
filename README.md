# 智能营销部创意图片平台

面向公司内部的图片创作工作台，首期提供文生图、单图图生图，以及百炼 Qwen Image 3.0 Pro 与 Gemini 3.1 Flash Image 并排比较。平台保存共享创作历史、供应商原币成本估算和账单周期汇总；收入核算和媒体广告 API 不在首期范围内。

工作台的布局和创作流程参考 [DSH Image Gen](https://github.com/shanliuling/dsh-image-gen)，仅作交互参考。本项目独立实现，未以该插件作为代码底座。参考仓库当前标注 Apache-2.0 许可证；本仓库没有复制其代码或素材。

## 技术结构

- Next.js / TypeScript 模块化单体，员工通过飞书 OAuth 和服务端白名单登录。
- PostgreSQL 保存用户、任务、调用、估算费用、账单和审计记录；pg-boss 使用同一数据库作为任务队列。
- 百炼与 Gemini 通过独立适配器调用。每个模型独立执行；超时或网络状态不明时标为“状态待核实”，不自动重发。
- 图片保存在服务器挂载的数据盘；80% 显示提醒，95% 阻止新任务。管理员可删除任务和图片。
- API 凭证使用 AES-256-GCM 加密后写入数据库，主密钥只由服务端环境提供。
- 账单连接器手动按月同步。百炼调用新版 `DescribeInstanceBill`；Google Cloud Billing 从 BigQuery 导出查询。账单汇总与逐次估算分开显示，不把汇总金额拆成单张图片费用。

## 本地开发

需要 Node.js 22+、npm 和 PostgreSQL 17+。复制环境模板并填写本地数据库地址：

```sh
cp .env.example .env
```

本地体验可在 `.env` 中设置 `DEV_AUTH_BYPASS=1`，再执行：

```sh
npm ci
npm run db:migrate
npm run dev
```

另开终端启动队列工作进程：

```sh
npm run worker
```

要用 Docker Compose 启动 PostgreSQL、迁移、Web 和 worker：先在 `.env` 配置 `POSTGRES_PASSWORD`、`APP_BASE_URL`，然后运行：

```sh
docker compose up --build
```

生产环境必须将 `DEV_AUTH_BYPASS` 设为 `0`，配置飞书应用 ID、Secret、回调 URL 和首个管理员 Open ID。生成 32 字节加密密钥可运行 `openssl rand -hex 32`。`.env` 应仅保存在服务器并限制为 `0600`；Google 服务账号 JSON 放在 `secrets/google-billing.json`，该文件已被 Git 忽略。

## 验证

```sh
npm run typecheck
npm test
npm run build
```

部署说明和必要的前置配置见 [服务器部署与上线检查](docs/deployment.md)，数据流和权限边界见 [架构说明](docs/architecture.md)。

## 尚需配置才能进行真实联调

- 飞书自建应用及 IP HTTPS 回调地址。
- 百炼和 Gemini 图片生成 API Key，以及百炼对应地域和业务空间 Endpoint。
- 管理员设置各模型单张价格和生效汇率，成本才会出现估算数值。
- 百炼账单只读 RAM 凭证、产品代码；Google Cloud Billing BigQuery 导出、服务账号只读权限和服务筛选值。
- 服务器的数据盘挂载、IP HTTPS 证书自动续期监控和生产备份位置。
