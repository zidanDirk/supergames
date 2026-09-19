# 每日网页游戏创意 Issue：从零部署

完成后，腾讯云服务器会在每天北京时间 10:00 通过 Claude Code 调用 **DeepSeek V4.1 Flash**，联网研究优秀网页游戏，并给 `zidanDirk/supergames` 创建 1 个可由 Codex 落地的高质量游戏创意 Issue。

DeepSeek V4.1 Flash 当前的稳定 API 模型名是 `deepseek-flash`。不要改成展示名称 `DeepSeek-V4.1-Flash`。

## 任务的安全与质量保护

- Claude Code 仅可使用 `WebSearch` 和 `WebFetch`，不能执行命令或修改仓库。
- 脚本负责 GitHub 写入，模型不会直接获得 GitHub 工具权限。
- 同一天的 Issue 带有幂等标记，cron 重复执行不会重复创建。
- 自动检查章节、正文长度、至少 8 条验收标准、至少 3 个来源 URL 和历史标题相似度。
- 自动质检不通过时默认重做一次，最多可通过 `GAME_IDEA_MAX_ATTEMPTS` 设置为 1–3 次。
- `flock` 防止上一轮尚未结束时并发创建。
- 该任务的 DeepSeek 配置只对本次子进程生效，不会覆盖服务器上原有的 MiniMax Claude Code 配置。

## 第 1 步：准备两个密钥

### 1.1 DeepSeek API Key

1. 登录 [DeepSeek 开放平台](https://platform.deepseek.com/)。
2. 进入 API Keys 页面创建一个新 Key。
3. 复制 `sk-...`，离开页面后通常无法再次查看完整值。
4. 确认 API 账户有可用余额。

### 1.2 GitHub Fine-grained PAT

1. 打开 GitHub：Settings → Developer settings → Personal access tokens → Fine-grained tokens。
2. 点击 Generate new token。
3. Repository access 选择 **Only select repositories**，只选择 `supergames`。
4. Repository permissions 设置：
   - Issues：**Read and write**
   - Metadata：Read-only（GitHub 会自动包含）
5. 创建并复制 `github_pat_...`。

不要把这两个密钥发到聊天、写进仓库或提交到 Git。

## 第 2 步：登录服务器并检查环境

从自己的电脑登录腾讯云服务器：

```bash
ssh <服务器用户名>@<服务器公网IP>
```

执行检查：

```bash
cat /etc/os-release
git --version
node --version
claude --version
command -v node
command -v claude
command -v flock
timedatectl status
```

要求：

- Node.js 18 或更高版本。
- `claude` 和 `flock` 均能找到。
- 记下 `command -v node`、`command -v claude` 的完整输出，后面要填写。
- 记下 `timedatectl status` 中的 `Time zone`。

建议更新 Claude Code 后再继续：

```bash
claude update
claude --version
```

## 第 3 步：把本仓库改动推送到 GitHub

在包含这些新增文件的开发电脑上执行：

```bash
cd /path/to/supergames
git status
node --test automation/daily-game-idea/run.test.mjs
git add .gitignore automation/daily-game-idea
git commit -m "feat: add daily web game idea automation"
git push origin master
```

推送前务必确认 `git status` 中没有 `.env`、API Key 或其他秘密文件。

## 第 4 步：在腾讯云服务器取得最新代码

如果服务器已经有该仓库：

```bash
cd /服务器上的/supergames
git remote -v
git pull --ff-only
```

如果服务器尚未克隆该仓库，推荐放到当前用户的 home 目录：

```bash
cd "$HOME"
git clone https://github.com/zidanDirk/supergames.git
cd "$HOME/supergames"
```

以下命令可以确认仓库的绝对路径：

```bash
pwd
```

后续示例使用 `$HOME/supergames`。若你的路径不同，请替换为真实绝对路径。

## 第 5 步：创建仅服务器可读的环境配置

```bash
mkdir -p "$HOME/.config/supergames"
install -m 600 \
  "$HOME/supergames/automation/daily-game-idea/supergames-game-idea.env.example" \
  "$HOME/.config/supergames/game-idea.env"
nano "$HOME/.config/supergames/game-idea.env"
```

至少修改以下项目：

```dotenv
DEEPSEEK_API_KEY=sk-你的真实DeepSeek密钥
GITHUB_TOKEN=github_pat_你的真实GitHub令牌
GITHUB_REPOSITORY=zidanDirk/supergames
SUPERGAMES_REPO_DIR=/你的真实绝对路径/supergames
CLAUDE_BIN=/command-v-claude的真实输出
NODE_BIN=/command-v-node的真实输出
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_EFFORT=max
DRY_RUN=1
```

保存后检查权限，但不要打印文件内容：

```bash
chmod 600 "$HOME/.config/supergames/game-idea.env"
ls -l "$HOME/.config/supergames/game-idea.env"
```

正确权限应以 `-rw-------` 开头。

## 第 6 步：运行本地测试

```bash
cd "$HOME/supergames"
chmod +x automation/daily-game-idea/run.sh automation/daily-game-idea/run.mjs
node --test automation/daily-game-idea/run.test.mjs
```

应看到 5 个测试全部通过。这一步不访问网络，也不会消耗 DeepSeek API。

## 第 7 步：执行安全演练

环境配置中的 `DRY_RUN=1` 会执行真实联网研究，但只在终端打印 Issue，不会写入 GitHub：

```bash
cd "$HOME/supergames"
automation/daily-game-idea/run.sh 2>&1 | tee /tmp/supergames-game-idea-dry-run.log
```

首次运行可能需要数分钟。成功时应看到：

- `DRY_RUN 已启用，不会创建 GitHub Issue`；
- 一个 `[Game Idea]` 标题；
- 完整玩法、实现范围、至少 8 条验收标准；
- 至少 3 个可打开的参考来源。

如果失败，查看日志末尾：

```bash
tail -n 100 /tmp/supergames-game-idea-dry-run.log
```

## 第 8 步：创建第一条正式 Issue

编辑配置：

```bash
nano "$HOME/.config/supergames/game-idea.env"
```

把 `DRY_RUN=1` 改为：

```dotenv
DRY_RUN=0
```

然后手动运行：

```bash
cd "$HOME/supergames"
automation/daily-game-idea/run.sh
```

成功时会输出新 Issue 的编号和 URL。打开仓库 Issues 页面检查内容。同一天再次执行会检测日期标记并安全跳过。

仓库目前如果没有 `game-idea`、`daily-research` 标签，脚本会打印提示并跳过标签，不会影响 Issue 创建。标签以后可在 GitHub 仓库的 Issues → Labels 页面创建。

## 第 9 步：添加每天北京时间 10:00 的 cron

先备份已有定时任务，避免影响坦克资讯任务：

```bash
crontab -l > "$HOME/crontab-backup-$(date +%Y%m%d-%H%M%S).txt"
mkdir -p "$HOME/supergames/logs"
crontab -e
```

根据第 2 步看到的服务器时区，只添加下面其中一行：

服务器时区是 `Asia/Shanghai`：

```cron
0 10 * * * /你的真实绝对路径/supergames/automation/daily-game-idea/run.sh >> /你的真实绝对路径/supergames/logs/daily-game-idea.log 2>&1
```

服务器时区是 `UTC`：

```cron
0 2 * * * /你的真实绝对路径/supergames/automation/daily-game-idea/run.sh >> /你的真实绝对路径/supergames/logs/daily-game-idea.log 2>&1
```

中国全年为 UTC+8，因此 UTC 的 02:00 就是北京时间 10:00。不要在不知道原有任务依赖哪个时区时直接修改整台服务器的时区。

保存后检查，确认原来的坦克任务仍然存在，新任务只出现一次：

```bash
crontab -l
```

## 第 10 步：验证无人值守环境

cron 的环境比登录 shell 更精简。可以用接近 cron 的环境手动验证：

```bash
env -i \
  HOME="$HOME" \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /bin/bash "$HOME/supergames/automation/daily-game-idea/run.sh"
```

若当天已经创建过 Issue，输出“已经创建过……跳过”即表示脚本和密钥路径均正常。

第二天 10:00 后检查：

```bash
tail -n 200 "$HOME/supergames/logs/daily-game-idea.log"
```

## 常见问题

### 找不到 node 或 claude

cron 不会加载 `.bashrc` 或 nvm。把下面命令得到的绝对路径写入环境文件：

```bash
command -v node
command -v claude
```

### DeepSeek 返回 401

检查 `DEEPSEEK_API_KEY` 是否完整、账户是否有余额，以及 `DEEPSEEK_BASE_URL` 是否仍为：

```text
https://api.deepseek.com/anthropic
```

### GitHub 返回 403

检查 Fine-grained PAT 是否只选择了正确仓库，并具有 `Issues: Read and write`。

### 当天没有创建 Issue

依次检查：

```bash
crontab -l
tail -n 200 "$HOME/supergames/logs/daily-game-idea.log"
date
```

任务最长运行时间默认 45 分钟，可通过 `CLAUDE_TIMEOUT_MS` 调整。单次结果未通过格式、来源、验收项或重复度检查时会自动重试；默认最多 2 次。

### 暂停任务

执行 `crontab -e`，在该任务行前加 `#` 或删除该行。原有坦克任务不需要修改。

## 相关官方文档

- [DeepSeek 接入 Claude Code](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)
- [Claude Code CLI 参数](https://code.claude.com/docs/en/cli-usage)
- [GitHub 创建 Issue API](https://docs.github.com/en/rest/issues/issues#create-an-issue)
