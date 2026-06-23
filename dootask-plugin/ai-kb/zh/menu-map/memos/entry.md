---
id: memos.entry.menu-map
title: Memos 笔记入口
type: menu-map
feature: memos
scope: end-user
locale: zh
aliases:
  - Memos 在哪
  - 怎么打开 Memos
  - 找不到 Memos
  - 笔记入口
  - memos 应用入口
related_tools: []
related_pages: [application]
prerequisites:
  - 应用市场已安装 memos 插件
negative:
  - 主程序不内置 Memos，未装插件时入口不会出现
  - 入口对所有登录用户可见，不要求管理员权限
last_verified: v1.7.90
---

# Memos 笔记入口

## 路径
Memos 由独立插件（应用市场 app id `memos`）提供，安装后在应用中心注册一个菜单项：

- 桌面端：左侧栏「应用」→「Memos 笔记」（对应 URL `apps/memos/`）
- 移动端：底部 Tabbar「应用」→「Memos 笔记」
- URL 上会自动附带 `token`、`lang`、`theme` 参数，用于单点登录与主题同步

## 加载方式
- 以 iframe 形式嵌入打开：桌面端在新窗口打开（iframe_blank），移动端等其他场景内嵌在主框架内
- 非沉浸式展示（不抢占安全区），并隐藏 DooTask 的浮动胶囊条（与 Memos 自带顶栏重叠）
- 返回主程序请使用 Memos 左侧栏的「关闭应用」按钮

## 权限要求
- 所有已登录的 DooTask 用户可见可用
- 是否成为 Memos 管理员，由安装时的「管理员」配置决定（其余用户为普通成员）

## 看不到入口怎么办
1. 确认应用市场已安装 `memos` 插件
2. 容器首次启动需要拉取镜像，可能等待几分钟
3. 刷新页面或重新登录 DooTask 让菜单生效

## 相关
- 插件元信息：[[memos.plugin.concept]]
- Memos 是什么：[[memos.concept]]
- 写一条 memo：[[memos.create.howto]]
