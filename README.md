# DooTask Memos

AI智能配置memos在`/apps/memos`子路径运行的Docker镜像构建项目。

## 快速使用

```bash
docker run -d \
  --name dootask-memos \
  -p 5230:5230 \
  -v ~/.memos/:/var/opt/memos \
  dootask/memos:latest
```

访问：`http://your-domain/apps/memos`

## 构建配置

项目使用AI自动配置原版memos适配子路径部署：

- `configure_subpath.py` - AI配置脚本
- `configure_subpath.yaml` - 配置任务定义
- `Dockerfile` - 容器构建
- `.github/workflows/` - 自动化构建

## GitHub Secrets

设置仓库密钥以启用自动构建：

- `DOCKER_HUB_USERNAME` - Docker Hub用户名  
- `DOCKER_HUB_TOKEN` - Docker Hub访问令牌
- `OPENAI_API_KEY` - OpenAI API密钥(必须)

推送代码自动构建`dootask/memos:latest`镜像。
