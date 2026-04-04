# 阿里云轻量服务器部署 relay

目标：保留主站继续跑在 Vercel，把 `server/asr-relay.ts` 单独部署到阿里云轻量应用服务器。

## 1. 服务器准备

- Ubuntu 22.04
- 安全组放行 `80` 和 `443`
- 域名解析到服务器，例如 `relay.example.com`
- 安装 Node.js 20+、npm、nginx

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
```

## 2. 拉代码并安装依赖

```bash
cd /root
git clone <your-repo-url> /root/talk-with-buffett
cd /root/talk-with-buffett
npm ci
```

`relay` 运行时依赖 `ts-node`，这里不要用 `npm ci --omit=dev`。

## 3. 配置 relay 环境变量

创建 `/root/talk-with-buffett/.env.relay`：

```bash
PORT=3001
ALLOWED_ORIGIN=https://air7.fun
VOLCENGINE_ASR_APP_ID=xxxx
VOLCENGINE_ASR_ACCESS_TOKEN=xxxx
VOLCENGINE_ASR_CLUSTER=volcengine_streaming
VOLCENGINE_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
VOLCENGINE_ASR_WS_URL=wss://openspeech.bytedance.com/api/v2/asr
```

如果前端域名不是 `https://air7.fun`，把 `ALLOWED_ORIGIN` 改成你的实际站点。

## 4. 配置 systemd

```bash
sudo cp deploy/aliyun-lightserver/relay.service /etc/systemd/system/talk-with-buffett-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now talk-with-buffett-relay
sudo systemctl status talk-with-buffett-relay
```

## 5. 配置 Nginx

```bash
sudo cp deploy/aliyun-lightserver/nginx-relay.conf /etc/nginx/sites-available/talk-with-buffett-relay
sudo ln -sf /etc/nginx/sites-available/talk-with-buffett-relay /etc/nginx/sites-enabled/talk-with-buffett-relay
sudo nginx -t
sudo systemctl reload nginx
```

把配置里的 `relay.example.com` 替换成你的真实域名。

## 6. 配置 HTTPS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d relay.example.com
```

## 7. 验证 relay

```bash
curl https://relay.example.com/healthz
```

预期返回：

```json
{"ok":true}
```

## 8. 回填前端环境变量

在 Vercel 项目里设置：

```bash
ASR_RELAY_URL=https://relay.example.com
```

这样 `/api/asr/realtime/*` 会自动转发到阿里云上的 relay。

## 9. 更新发布

```bash
cd /root/talk-with-buffett
git pull
npm ci
sudo systemctl restart talk-with-buffett-relay
```
