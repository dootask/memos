---
name: release-plugin
description: 发布 DooTask Memos 插件新版本：更新中英双语 CHANGELOG、确定版本号、打 tag 并推送、监控 GitHub Action 直至发布到 Docker Hub 和 DooTask AppStore 成功。用户要发版/打 tag/出新版本时使用。
---

# 发布 DooTask Memos 插件

本仓库通过推送 tag 触发 GitHub Action 自动构建多架构镜像并发布到 Docker Hub（`dootask/memos`）和 DooTask AppStore（appid `memos`）。

## ⚠️ 本项目特殊约定（容易踩坑）

1. **Tag 不带 `v` 前缀**：直接 `0.1.1`，不是 `v0.1.1`。
2. **CHANGELOG 在模板目录**：编辑 `dootask-plugin/version/CHANGELOG.md` 和 `_zh.md`。Workflow 在 runner 里把 `version/` 临时重命名为 tag 名（如 `0.1.1`）再打包，repo 里的 `version/` 永远不变 —— **不要**在 repo 里手动维护 `dootask-plugin/<具体版本号>/` 子目录。
3. **镜像名固定为 `dootask/memos`**：与 `dootask-plugin/version/docker-compose.yml` 里 `image: dootask/memos:${PLUGIN_VERSION}` 一致。改镜像名两处必须同步改。

## 触发条件回顾

只有 **推送 tag** 才会触发构建发布，普通 push 或 PR 不会跑 workflow。

## 发布流程

按顺序执行下面的步骤。每一步都先与用户确认再操作 —— 发布是公开行为且涉及多个外部系统（Docker Hub、DooTask AppStore），不可逆。

### 1. 确认当前状态干净

```bash
git status
git log --oneline -10
```

确认：工作区干净、在 `main` 分支、本地与远程同步（`git fetch && git status`）。

### 2. 决定新版本号

```bash
git tag --sort=-creatordate | head -5
```

与用户确认新版本号，遵循语义化版本（SemVer），**不带 `v` 前缀**：

- `0.x.Y` patch：bugfix
- `0.X.0` minor：新功能、不破坏兼容
- `X.0.0` major：破坏性变更

### 3. 更新 CHANGELOG（中英双语）

同步更新这两个文件：
- `dootask-plugin/version/CHANGELOG.md`（英文）
- `dootask-plugin/version/CHANGELOG_zh.md`（中文）

**覆盖式，不是追加式** —— 每次发版直接替换为本次更新内容，不保留上一版条目（AppStore 自己维护历史），文件里不写版本号和日期。

按分类列点，只用本次涉及的分类。常用分类（中英严格对应）：

| 英文 | 中文 |
|------|------|
| Added | 新增 |
| Fixed | 修复 |
| Updated | 更新 |
| Changed | 变更 |
| Improved | 优化 |
| Removed | 移除 |

写法：一句话一条、写给最终用户看、中英两文件分类与条数一一对应、保持简洁。

### 4. 提交 CHANGELOG 并推送

```bash
git add dootask-plugin/version/CHANGELOG.md dootask-plugin/version/CHANGELOG_zh.md
git commit -m "docs(changelog): notes for 0.1.1"   # 替换为实际版本号
git push origin main
```

### 5. 打 tag 并推送

```bash
git tag 0.1.1                       # ⚠️ 不带 v 前缀
git push origin 0.1.1
```

> tag 推送到远程会立即触发 Action。推送前再次确认版本号无误、CHANGELOG 已在 main 上。
> 误推可用 `git push --delete origin 0.1.1 && git tag -d 0.1.1` 删除（若已发布到 AppStore 则删 tag 不会撤回）。

### 6. 监控 GitHub Action

```bash
gh run list --workflow=release.yml --limit 3
gh run watch
```

或浏览器打开：`https://github.com/dootask/memos/actions`

### 7. 验证发布结果

- Docker Hub `dootask/memos` 出现新 tag
- DooTask AppStore 中 `memos` 插件版本已更新，更新说明显示本次 CHANGELOG

## 常见问题

**Action 没触发**：确认 tag 真的推到了远程（`git push origin <tag>`），仅 `git tag` 不推送。

**Tag 带了 `v` 前缀**：会破坏 Docker tag 排序和 AppStore 显示，立即删 tag 重打。

**`mv version <tag>` 失败**：repo 里不要保留 `dootask-plugin/<具体版本号>/` 子目录，只维护 `dootask-plugin/version/`。

**Docker 登录失败**：secrets 名是 `DOCKER_USERNAME` / `DOCKER_PASSWORD`。

**AppStore 发布失败**：检查 `dootask-plugin/version/config.yml` 是否合法，以及 `DOOTASK_USERNAME` / `DOOTASK_PASSWORD` 是否有效。

**版本号已存在**：AppStore 不允许重复版本号，递增 patch（`0.1.1` → `0.1.2`）。

<!--
================================================================================
GitHub Secrets 配置（仅供参考，本技能不会也无法配置这些密钥）

  - DOOTASK_USERNAME : DooTask AppStore 用户名
  - DOOTASK_PASSWORD : DooTask AppStore 密码
  - DOCKER_USERNAME  : Docker Hub 用户名（应为 dootask）
  - DOCKER_PASSWORD  : Docker Hub 密码或 Access Token
================================================================================
-->
