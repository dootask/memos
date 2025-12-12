# 子目录（多级路径）部署

此 fork 版本的 Memos 支持部署在反向代理后的子目录下，例如 `/apps/memos`。  
开启后，Web UI 与所有 HTTP API 都可以在子目录前缀下正常工作。

## 开启子目录支持

在服务端设置一个 URL 前缀：

- 启动参数：`--base-path /apps/memos`
- 环境变量：`MEMOS_BASE_PATH=/apps/memos`

规则：

- 前缀可以是多段路径（例如 `/a/b/c`）。
- 末尾是否带 `/` 都可以，服务端会自动规范化。
- 为空或 `/` 表示根路径部署（默认行为）。

## 用相同前缀构建前端

前端必须用相同的 base path 构建，才能保证静态资源与 SPA 路由正确解析。

```bash
export MEMOS_BASE_PATH=/apps/memos
pnpm -C web install
pnpm -C web release
```

`pnpm release` 会把产物输出到 `server/router/frontend/dist`。

## 运行（本地二进制）

```bash
./memos --mode prod --port 5230 --base-path /apps/memos
```

或使用环境变量：

```bash
MEMOS_BASE_PATH=/apps/memos ./memos --mode prod --port 5230
```

## 运行（Docker）

先构建镜像（需先完成上面的前端 release 构建）：

```bash
docker build -f scripts/Dockerfile -t memos:subpath .
```

启动容器：

```bash
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v /opt/memos:/var/opt/memos \
  -e MEMOS_MODE=prod \
  -e MEMOS_PORT=5230 \
  -e MEMOS_BASE_PATH=/apps/memos \
  memos:subpath
```

## 反向代理

重要：**反向代理不要剥掉前缀**。  
请求必须以 `/apps/memos/...` 的形式到达 Memos，服务端会在内部剥离该前缀。

### Nginx 示例

```nginx
server {
  listen 80;
  server_name example.com;

  client_max_body_size 200m;

  location = /apps/memos {
    return 301 /apps/memos/;
  }

  location /apps/memos/ {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_pass http://127.0.0.1:5230;
  }
}
```

### Caddy 示例

使用 `handle`（不要用 `handle_path`）以保留前缀：

```caddy
example.com {
  handle /apps/memos/* {
    reverse_proxy 127.0.0.1:5230
  }
}
```

## 验证清单

- 打开 `https://example.com/apps/memos/`，可以正常登录。
- 页面跳转与刷新后 URL 仍然保持在 `/apps/memos/...` 下。
- 附件/头像等资源从 `/apps/memos/file/...` 加载。
- 浏览器 DevTools 的网络请求显示 API 走 `/apps/memos/memos.api.v1.*` 或 `/apps/memos/api/v1/...`。

## 备注

- 若希望“复制/分享链接”带上前缀，可设置：
  `MEMOS_INSTANCE_URL=https://example.com/apps/memos`
  （或在实例设置中更新该 URL）。
- 未设置 `MEMOS_BASE_PATH` 时，根路径部署行为不受影响。
