# 智能营销部创意图片平台

面向公司内部的图片创作工作台，首期提供文生图、单图图生图和多模型并排比较。模型目录覆盖阿里云百炼（Qwen Image、Wan、Z-Image）、Google Gemini 图像模型和智谱 GLM-Image；按各型号实际能力显示文生图/图生图选项，只展示当前已启用的模型，并按人民币折算参考单价升序排列。开始调用前，用户先确认本次预估费用。图片生成支持自定义目标宽高，服务器会等比填充并裁切到指定像素尺寸。图片命名模板可自定义前后缀，必须且只能包含一次 `{标识}`，并支持 `{日期}`、`{模型}`、`{员工姓名}` 通配符；每张图的 `{标识}` 替换为 8 位 Crockford Base32 编号，前 4 位区分提示词，后 4 位是该提示词下递增的图片序号。历史提示词可“直接使用”以沿用前 4 位；DeepSeek 重构出的新提示词使用新前缀。每套创作可以选择多个分类标签；标签全体成员共享、名称不区分大小写且不能重复。历史记录每个任务提供一个 ZIP 下载；“素材库”支持按标识、日期、多标签（满足任一或全部）、模型供应商和模型筛选，并将所选图片打包下载。工作空间保留“消耗统计”和“ROI 面板”待开发入口。DeepSeek 不作为图片生成模型接入；首期由 `deepseek-flash` 提供历史提示词搜索后的多选重构。平台保存共享创作历史、供应商原币成本估算和账单周期汇总；收入核算和媒体广告 API 不在首期范围内。

工作台的布局和创作流程参考 [DSH Image Gen](https://github.com/shanliuling/dsh-image-gen)，仅作交互参考。本项目独立实现，未以该插件作为代码底座。参考仓库当前标注 Apache-2.0 许可证；本仓库没有复制其代码或素材。

## 技术结构

- Next.js / TypeScript 模块化单体，员工通过飞书 OAuth 和服务端白名单登录。
- PostgreSQL 保存用户、任务、调用、估算费用、账单和审计记录；pg-boss 使用同一数据库作为任务队列。
- 百炼、Gemini 与智谱通过独立适配器调用。每个模型独立执行；超时或网络状态不明时标为“状态待核实”，不自动重发。DeepSeek API 凭证只用于提示词重构。
- 图片保存在服务器挂载的数据盘；80% 显示提醒，95% 阻止新任务。管理员可删除任务和图片。
- API 凭证使用 AES-256-GCM 加密后写入数据库，主密钥只由服务端环境提供。
- 模型目录与默认参考单价见[图片生成模型与参考价格](docs/model-pricing.md)；价格可由管理员按供应商地域和账户实际规则调整。
- 历史提示词可搜索、多选并通过 DeepSeek 一键重构；调用日志只记录用量和提示词长度，不保存重构请求的提示词正文。
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

## 当前运行状态

- 飞书 OAuth 和白名单已在部署环境配置，首位管理员登录已验证。生产 Open ID、应用 Secret、服务器地址和证书私钥不保存在仓库。
- 管理员可在“API 配置 → 飞书白名单”添加员工；新员工角色默认是“成员”。
- 百炼、Gemini、智谱图像模型凭证和 DeepSeek 提示词重构凭证已在服务器端加密存储；模型参考价格及区域差异见价格说明。
- 百炼和 Google Cloud Billing 的只读账单连接尚待凭证与筛选条件；收入核算和媒体广告 API 均为后续范围。
- 生产数据库和图片备份仍需配置独立备份目标并完成恢复演练。

更多产品决策、当前部署状态和后续工作见[项目记忆与交接](docs/project-memory.md)。
