# 图片生成模型与参考价格

**核对日期：2026-11-08**

此表用于平台的默认成本参考单价，按生成输出计价，不是供应商报价承诺。百炼价格按华北 2（北京）列出；Gemini 按 Gemini API 标准付费层列出；智谱按开放平台 GLM-Image 文档列出。区域、账号、促销、分辨率、输入图片和服务版本可能改变实际账单。管理员可在“API 配置”按实际开通区域修改各模型单价。

## 阿里云百炼

| 模型 | 文生图 | 图生图 | 1K/张 | 2K/张 | 说明 |
|---|---:|---:|---:|---:|---|
| Qwen Image 3.0 Pro | 是 | 是 | ¥0.25 | ¥0.50 | 编辑输入图片另有输入计费 |
| Qwen Image 3.0 | 是 | 是 | ¥0.18 | ¥0.18 | 编辑输入图片另有输入计费 |
| Qwen Image 2.1 Pro | 是 | 是 | ¥0.25 | ¥0.25 | 支持多参考图；本平台首期上传一张 |
| Qwen Image 2.1 Turbo | 是 | 是 | ¥0.10 | ¥0.10 | 支持多参考图；本平台首期上传一张 |
| Qwen Image 2.0 Pro / 2026-06-22 / 2026-04-22 / 2026-03-03 | 是 | 是 | ¥0.50 | ¥0.50 | 版本快照按对应官方价 |
| Qwen Image 2.0 / 2026-03-03 | 是 | 是 | ¥0.20 | ¥0.20 | 版本快照按对应官方价 |
| Wan 2.7 Image Pro | 是 | 是 | ¥0.50 | ¥0.50 | 文生图可到 4K；本平台当前开放 1K/2K |
| Wan 2.7 Image | 是 | 是 | ¥0.20 | ¥0.20 | 最高 2K |
| Wan 2.6 Image | 是 | 是 | ¥0.20 | ¥0.20 | — |
| Wan 2.6 Text-to-Image | 是 | 否 | ¥0.20 | ¥0.20 | — |
| Wan 2.5 Text-to-Image Preview | 是 | 否 | ¥0.20 | ¥0.20 | 预览型号 |
| Wan 2.5 Image-to-Image Preview | 否 | 是 | ¥0.20 | — | 单图编辑，输出最高约 1280px |
| Wan 2.2 Text-to-Image Plus | 是 | 否 | ¥0.20 | ¥0.20 | — |
| Wan 2.2 Text-to-Image Flash | 是 | 否 | ¥0.14 | ¥0.14 | — |
| Wan 2.1 Text-to-Image Plus | 是 | 否 | ¥0.20 | ¥0.20 | — |
| Wan 2.1 Text-to-Image Turbo | 是 | 否 | ¥0.14 | ¥0.14 | — |
| Wan 2.0 Text-to-Image Turbo | 是 | 否 | ¥0.04 | ¥0.04 | — |
| Wan 2.1 Image Edit（legacy） | 否 | 是 | ¥0.14 | — | 北京地域旧版通用图像编辑接口，单张输出 |
| Z-Image Turbo | 是 | 否 | ¥0.10 | ¥0.10 | 当前关闭提示词改写；开启时官方标准价为 ¥0.20/张 |

官方模型目录与价格：[图片生成和编辑能力目录](https://help.aliyun.com/zh/model-studio/image-model/) · [百炼模型调用价格](https://help.aliyun.com/zh/model-studio/model-pricing)。千问 3.0 Pro / 3.0 的图像编辑输入参考价为 ¥0.02/张，平台成本估算目前按生成输出单价计算，未加入此输入图片费用。

## Google Gemini API

| 模型 | 文生图 | 图生图 | 1K/张 | 2K/张 |
|---|---:|---:|---:|---:|
| Gemini 3 Pro Image | 是 | 是 | $0.134 | $0.134 |
| Gemini 3.1 Flash Image | 是 | 是 | $0.067 | $0.101 |
| Gemini 3.1 Flash Lite Image | 是 | 是 | $0.0336 | 不支持 |
| Gemini 2.5 Flash Image（已弃用） | 是 | 是 | $0.039 | 不支持 |

官方标准付费价格：[Gemini API 定价](https://ai.google.dev/gemini-api/docs/pricing)；图像模型能力：[图片生成指南](https://ai.google.dev/gemini-api/docs/image-generation)。Gemini 2.5 Flash Image 将于 2027-03-15 停止服务，作为旧模型保留以便过渡。输出参考价不包含提示词和输入图片 token 费用。

## 智谱 AI

| 模型 | 文生图 | 图生图 | 1K/张 | 2K/张 |
|---|---:|---:|---:|---:|
| GLM-Image | 是 | 否 | ¥0.10 | ¥0.10 |

官方说明为 ¥0.10/次，当前平台请求一张图，因此表格按每张显示。提示词限制为 1,000 字符；官方支持的尺寸为 512–2048 像素且边长为 32 的倍数。[GLM-Image 官方说明](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image)

## DeepSeek

DeepSeek 不作为图片生成模型。工作台提示词重构使用官方 OpenAI 兼容接口的 `deepseek-flash`（当前模型版本 DeepSeek-V4.1-Flash-1017），按 Token 计费。官方页面列出的标准价格会区分缓存命中/未命中和峰谷时段：缓存未命中输入约 $0.15–$0.30 / 百万 Token，输出约 $0.60–$1.20 / 百万 Token；缓存命中输入约 $0.003–$0.006 / 百万 Token。此价格易变，部署使用前应以[官方模型与价格页面](https://api-docs.deepseek.com/quick_start/pricing/)为准；接口和模型名见[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。提示词重构的 Token 用量记入审计日志，目前不并入图片逐次成本统计。

## 成本估算边界

- 上述价格是管理员配置的默认参考值，保存后会参与逐次成本估算；实际以供应商账单为准。
- 目前估算按生成成功的图片张数乘以对应输出单价；它不会将账期汇总账单拆成单张图片费用。
- Qwen Image 3.0 系列图生图的输入图片费用、Gemini 的文本/输入图片 token、以及不同地域价格可能增加实际成本。需要精确估算时，应根据账号地域和供应商实际计费进一步调整。
- 百炼当前统一按北京参考价预填；如果 Qwen API Key 属于新加坡等其他地域，应在管理员页面改成对应地域的价格。
