# Memos 笔记

[Memos](https://www.usememos.com) 是一款隐私优先、轻量级的开源笔记服务。本插件将其集成进 DooTask，并提供单点登录。

## 功能特性

- **自动注册 / 免密登录**：DooTask 用户打开插件即自动在 Memos 创建账号并登录，无需二次输入密码。
- **安装时设置管理员**：在安装界面选择若干 DooTask 用户作为 Memos 管理员，其余用户以普通成员身份登录。
- **同源二级目录访问**：通过主程序 nginx 以 `/apps/memos/` 子路径提供服务，与主程序同源、同一套 TLS，无需额外开放端口。
- **数据自托管**：使用 SQLite，数据保存在应用目录的 `data/memos` 下。

## 配置项

| 字段 | 说明 |
| --- | --- |
| 管理员 | 选择授予 Memos 管理员权限的 DooTask 用户。 |
| 内部密钥 | 用于派生账号密码与签名会话，安装后请勿修改。 |

## 工作原理

插件由两个容器组成，均不直接对外，统一经主程序 nginx 的 `/apps/memos/` 反向代理：

- `memos-server`：**自构建的 Memos 镜像**，前端已打补丁支持 `/apps/memos/` 子路径（资源、路由、API、附件、SSE 全部携带前缀）。
- `memos-proxy`：鉴权代理。它验证 DooTask 用户令牌、在 Memos 中按需建号、以确定性密码完成登录，注入访问令牌与 `memos_refresh` 续期 cookie，并将其余请求反向代理给 Memos。

为强制走单点登录，代理会拦截 Memos 的直接登录与自助注册接口（REST 与 connect-RPC 两种路径）。访问令牌过期后，前端用 `memos_refresh` cookie 通过 Memos 原生 `RefreshToken` 自动续期，会话最长 30 天。
