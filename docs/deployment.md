# 服务器部署与上线检查

目标环境为 Ubuntu 服务器。公网 IP、OAuth 回调地址、主机目录和证书路径属于部署配置，应只保存在服务器或未跟踪的本机配置中。应用容器只绑定宿主机 `127.0.0.1:3000`，公网 HTTPS 由 Nginx 代理。不要把 `.env`、TLS 私钥、飞书 Secret、模型 Key、云账单密钥或服务账号 JSON 提交到 Git。

## 1. 数据盘

先根据 `lsblk -f` 结果把 `DATA_DEVICE` 设为实际数据盘设备，再用 `blkid` 和 `wipefs -n "$DATA_DEVICE"` 确认该盘无分区、文件系统或现有数据。仅确认为空盘后才创建文件系统。创建挂载点时先设为 `root:root` 且权限 `000`，再用 UUID 写入 `/etc/fstab` 并挂载到服务器专用的数据目录；挂载成功后将文件系统根目录设为 UID/GID `1001`、权限 `0750`。这样数据盘意外未挂载时，容器不能把图片写到系统盘上的空挂载目录。重启后复核挂载，并将实际路径写入服务器 `.env` 的 `MEDIA_HOST_PATH`。

PostgreSQL 当前使用 Docker named volume，位于系统盘。上线前为数据库和图片文件确定独立于本机的备份目标，并执行一次恢复演练。

## 2. 应用配置与容器

在服务器上从仓库检出到干净目录，然后：

```sh
cp .env.example .env
chmod 600 .env
mkdir -p secrets
chmod 700 secrets
```

在 `.env` 设置：

- `POSTGRES_PASSWORD`：使用 URL 安全的随机十六进制值，例如 `openssl rand -hex 32`。
- `APP_BASE_URL=https://YOUR_PUBLIC_IP`。
- `FEISHU_REDIRECT_URI=https://YOUR_PUBLIC_IP/api/auth/callback`，且与飞书开放平台登记值完全一致。
- `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`BOOTSTRAP_ADMIN_OPEN_IDS`。
- `CREDENTIALS_ENCRYPTION_KEY`：新的 32 字节十六进制密钥。
- `MEDIA_HOST_PATH` 指向服务器数据盘目录，`SECRETS_HOST_PATH` 指向服务器私密配置目录。
- 百炼和 Gemini 图像 API 凭证只在管理员准备好后设置。
- 账单连接器配置好只读权限和账单范围后才填写相应账单环境变量。

Google Billing 服务账号 JSON 放入服务器 `secrets/google-billing.json`（权限 `0600`）。BigQuery 服务账号仅授予读取指定账单数据集的权限。百炼 RAM 用户仅授予 `bssapi:DescribeInstanceBill`，并设置正确的百炼账单产品代码，避免导入其他云产品费用。

启动并查看服务状态：

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web worker migrate
```

## 3. IP HTTPS 和 Nginx

Let’s Encrypt 已支持短期 IP 地址证书，证书有效期约 160 小时；Certbot 需要 5.4 或更新版本才支持 IP 的 webroot 验证。证书续期必须自动运行并监控失败。先确保云安全组和宿主机防火墙仅开放 SSH、HTTP、HTTPS，并保留 SSH 通道。

Nginx 需处理 `/.well-known/acme-challenge/`，其余请求代理到 `http://127.0.0.1:3000`，并转发原始 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`。将 Nginx 模板中的 `YOUR_PUBLIC_IP` 和证书路径替换为服务器实际公网 IP。确认 HTTP-01 挑战可从公网访问后，用 Certbot `--ip-address "$PUBLIC_IP" --preferred-profile shortlived` 签发。配置 Certbot 的自动续期定时器及部署钩子重载 Nginx，并设置过期时间监控；只有证书和续期告警都通过后才登记飞书 OAuth IP 回调地址。

仓库提供 Nginx、续期部署钩子和 systemd 证书检查定时器模板。签发证书后安装 `ops/nginx.conf` 到 `/etc/nginx/sites-available/smart-creative`，将 `ops/reload-nginx-after-renewal.sh` 安装到 `/etc/letsencrypt/renewal-hooks/deploy/`，把 `ops/check-cert-expiry.sh` 安装为 `/usr/local/sbin/smart-creative-check-cert-expiry`，并安装 `ops/smart-creative-cert-check.service` 和 `.timer` 到 `/etc/systemd/system/`。在 `/etc/default/smart-creative` 设置 `PUBLIC_IP`，供证书检查服务定位证书。执行 `systemctl daemon-reload`、启用检查定时器，并确认 `certbot.timer` 和 `smart-creative-cert-check.timer` 均处于活动状态。检查失败会记录到 systemd journal；外部通知渠道需另行配置。

证书私钥保存在 `/etc/letsencrypt`，不复制进仓库或 Docker 镜像。不要关闭证书校验或在 Nginx 与应用之间使用公网明文连接。

## 4. 上线验收

- 未登录和不在白名单的飞书用户不能打开平台 API；首个管理员能登录并维护白名单。
- 管理员配置模型 Key 后，普通成员可以调用启用模型；成员不能读取 Key、删除记录或查看管理页面。
- 文生图、多图图生图（最多 10 张）、两模型并行、单模型/单原图部分失败、超时状态待核实和管理员删除都能通过界面复核；图生图成本按原图数乘每张数量计算。
- Nginx 与应用请求体上限均允许最多 10 张、每张 10 MiB 的输入（配置 110 MiB 请求上限）。
- 历史记录和素材库默认每页 20 条，可切换到 100 或 500；列表请求只返回 300×300 缩略图，点击后才能读取原图。
- 数据盘达到 80% 时显示提醒；达到 95% 时拒绝新任务；扩容并恢复挂载后确认新任务重新开放。
- 数据库备份、图片备份、TLS 自动续期、证书到期告警和备份恢复演练均完成。
- 账单连接器第一次同步需核对供应商账号、账期、产品/服务筛选、币种和账单总额；不要用模型总账单推算单张图片实际成本。
