# Overrides for /apps/memos Subpath

预配置的文件，用于将 memos 配置为在 `/apps/memos` 子路径下运行。

## 文件说明

- `apply.sh` - 应用配置覆盖的执行脚本
- `web/vite.config.mts` - 前端配置（base: "/apps/memos/"）
- `server/router/frontend/frontend.go` - 后端配置（/apps/memos 路由）

## 使用方式

GitHub Actions 会自动执行 `./overrides/apply.sh` 来应用配置。

最终访问地址：`http://your-domain/apps/memos`
