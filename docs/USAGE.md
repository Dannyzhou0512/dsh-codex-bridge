# 使用指南

## Windows 快速开始

按 README 中的[安装](../README.md#1-在-dsh-中安装)、[配置](../README.md#2-配置-codex-历史来源)和[试跑、导入并续聊](../README.md#3-试跑导入并续聊)步骤开始。适用版本为 DSH `0.2.2-rc.3`。首次使用保留 `writeEnabled: false`。

首次试跑时，在单独的 PowerShell 窗口指定一个新的 Harness home。以下示例把它放在当前项目内，关闭该窗口后环境变量不会影响其他启动器。

~~~powershell
$env:DSH_HOME = Join-Path (Get-Location).Path '.dsh-bridge-test'
~~~

## 构建与安装

根目录npm ci --ignore-scripts、npm run package:verified生成新的已验证tar路径。可选UI先在根目录build，再到packages/client/dsh-codex-bridge-ui安装开发依赖并npm test，输出新的UI测试tar路径。用你的已安装dsh公开plugin管理器安装这些本机tar；不要把Git URL直接当built bundle，不自动安装SDK peers。

## npm 预览包

两个 scoped 包已发布到 npm 的 `preview` 标签。侧栏需要同一个 profile 同时安装主包和 UI。

~~~powershell
dsh plugin --profile desktop add '@dannyzhou/dsh-codex-bridge@0.0.10' '@dannyzhou/dsh-codex-bridge-ui@0.0.9' --ignore-scripts
~~~

从本仓库的旧 GitHub 预览包迁移时，先备份目标 profile 自己的配置补丁，在退出 Desktop 后移除旧 UI 和旧主包，再安装上述一对包。保留现有 Session 和 Workspace 数据以及 `dsh-codex-bridge-ui`、`dsh-codex-bridge-host` 实例 ID 的配置。若自定义补丁中还写了旧的模块 `name`（包括专用 CLI 的入口），把它改为对应 scoped 名称。两个发行渠道各自配套安装。

使用旧 GitHub 归档时，从[旧版 Release](https://github.com/Dannyzhou0512/dsh-codex-bridge/releases/tag/v0.0.10-preview.1)下载配套的两个归档，并按[该版本的指南](https://github.com/Dannyzhou0512/dsh-codex-bridge/blob/v0.0.10-preview.1/docs/USAGE.md)安装。

## UI

在同一个 Web profile 安装主包和 UI 包。按[UI 配置示例](UI_CONFIG_EXAMPLE.json)填写可信 Codex 可执行文件、启动目录与 Codex home，保持 `writeEnabled: false` 进行首次试跑。

~~~text
dsh plugin --profile web add "<主包绝对路径>" "<UI 包绝对路径>"
dsh --profile web --patch "<配置补丁绝对路径>"
~~~

配置补丁使用以下结构，把 `UI_CONFIG` 替换为填写好的配置对象。为已有 profile 使用独立补丁文件，可以保留原有配置。

~~~yaml
- id: dsh-codex-bridge-ui
  config: UI_CONFIG
~~~

单条导入时，点会话旁的「导入…」或预览顶部的「导入此会话」，核对目标目录和转换变化。写入已启用时，点「接受上述变化并导入」，插件会自动试跑并复核来源和目标。也可以点「仅试跑」。如果工作目录不可用，填写一个已存在的目录并点「重新检查」。

批量导入时，先进入「批量导入」，再勾选并预览所需会话，逐项确认转换损失。在列表上方点击「审核所选会话」，核对目标目录后点击「Dry-run（不写入）」。如显示 `already-imported`，可以在目标工作区打开已有会话。需要实际写入时才启用 `writeEnabled`，通过同一次审核的试跑后，勾选确认并点击「实际导入所选会话」。收到结果不确定提示时，先重新审核同一目标。

在目标工作区打开会话。UI 0.0.7 起在「对话」页将旧回复展开为「来自 Codex 的历史回复」，之前导入的会话也适用。要查看历史工具信息或推理摘要，可以打开会话的「轨迹」。如果对话里显示 `localImage` 已省略，续聊时需要手动附上原图。

## CLI

用公开插件管理器把主包安装到专用 profile，例如 `dsh plugin --profile codex-import add "<主包绝对路径>"`。rc.3 初始化自定义 profile 时会挂载 `dsh-base`，它提供 Session 持久化。再挂载 `@deepseek-ai/dsh-workspace` 和 `@dannyzhou/dsh-codex-bridge/cli`，即可使用下面的命令。使用旧 GitHub 安装包时，CLI 模块名仍为 `dsh-codex-bridge/cli`。CLI 和用于打开导入结果的 Harness 必须指向同一个 Session 和 Workspace 数据集。

在专用 profile 的 `cordis.patch.yml` 中插入以下两项。把 `CLI_CONFIG` 换成[配置示例](P10_CLI_CONFIG_EXAMPLE.json)中的对象，并填写可信 Codex 可执行文件、启动目录和 Codex home。

~~~yaml
- insert:
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: codex-import-cli
      name: '@dannyzhou/dsh-codex-bridge/cli'
      config: CLI_CONFIG
~~~

~~~text
dsh --profile codex-import --bridge-version
dsh --profile codex-import list
dsh --profile codex-import preview --thread THREAD_ID --mode recall
dsh --profile codex-import plan --thread THREAD_ID --mode recall --accept-loss assistant-role-recall --accept-loss tool-information-recall
dsh --profile codex-import apply --thread THREAD_ID --mode recall --accept-loss assistant-role-recall --accept-loss tool-information-recall --dry-run
~~~

示例的两项loss不是全局默认，也不适用于所有会话；以每条预览的requiredLosses为准。cwd缺失需--remap EXISTING_ABSOLUTE_DIRECTORY，不创建目录。确认实际目标/选择/损失与dry-run后，使用同一参数加--execute --reviewed-digest PLAN_REVIEW_DIGEST；--execute与--dry-run冲突。launcher的--profile在业务参数之前。

导入后通过宿主原生Session打开、Workspace关联和正常重启读回检查。发送真实模型验收消息须另在已授权范围内进行；工具/历史内容不由迁移自动执行。
