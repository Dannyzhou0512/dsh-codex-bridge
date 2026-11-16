# 使用指南

## Windows 快速开始

1. 在目标 DSH 启动器运行 `dsh --version`，确认是 `0.2.2-rc.3`。从 [GitHub 预览版](https://github.com/Dannyzhou0512/dsh-codex-bridge/releases/tag/v0.0.10-preview.1) 下载 `dsh-codex-bridge-0.0.10.tgz` 和 `dsh-codex-bridge-ui-0.0.9.tgz`。可用 `Get-FileHash -Algorithm SHA256` 将包的校验值与 `SHA256SUMS.txt` 核对。
2. 首次使用时先启动 Desktop 一次，初始化目标 profile，再通过应用菜单退出。在 PowerShell 切换到下载目录，用当前 Desktop 使用的 DSH 启动器安装两个包。若 `dsh` 未加入 PATH，在下面命令中使用安装目录内的 `resources/runtime/cli/bin/dsh.cmd` 完整路径。若 Desktop 使用自定义 `DSH_HOME`，在 PowerShell 中设置相同目录。

   ```powershell
   $main = (Resolve-Path -LiteralPath '.\dsh-codex-bridge-0.0.10.tgz').Path
   $ui = (Resolve-Path -LiteralPath '.\dsh-codex-bridge-ui-0.0.9.tgz').Path
   dsh plugin --profile desktop add $main $ui --ignore-scripts
   ```

3. 在目标 `profiles/desktop/cordis.patch.yml` 中找到 `dsh-codex-bridge-ui` 条目，按 [配置示例](UI_CONFIG_EXAMPLE.json) 补齐它的 `config`。把 `reader.executable` 填成可信 Codex 可执行文件的完整路径，`reader.args` 设为 `[app-server]`，`reader.cwd` 与 `reader.codexHome` 填自己的目录。已有条目直接编辑。首次使用保持 `writeEnabled: false`。
4. 打开 Desktop，进入「Codex 历史」，点「扫描历史」和目标会话的「预览」。在预览顶部点「导入此会话」，核对目标目录，点「仅试跑」。确认需要实际导入时，在同一配置中启用 `writeEnabled: true`，重启 Desktop，再从该会话的确认面板导入。完成后在目标工作区打开会话。

先用目标启动器的 `dsh --version` 确认版本为 **0.2.2-rc.3**。这版主插件是 `0.0.10`，配套 UI `0.0.9` 为预览。使用专用隔离 profile 初次试跑，通过后再决定实际目标环境。

首次试跑时，在单独的 PowerShell 窗口指定一个新的 Harness home。以下示例把它放在当前项目内，关闭该窗口后环境变量不会影响其他启动器。

~~~powershell
$env:DSH_HOME = Join-Path (Get-Location).Path '.dsh-bridge-test'
~~~

## 构建与安装

根目录npm ci --ignore-scripts、npm run package:verified生成新的已验证tar路径。可选UI先在根目录build，再到packages/client/dsh-codex-bridge-ui安装开发依赖并npm test，输出新的UI测试tar路径。用你的已安装dsh公开plugin管理器安装这些本机tar；不要把Git URL直接当built bundle，不自动安装SDK peers。

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

用公开插件管理器把主包安装到专用 profile，例如 `dsh plugin --profile codex-import add "<主包绝对路径>"`。rc.3 初始化自定义 profile 时会挂载 `dsh-base`，它提供 Session 持久化。再挂载 `@deepseek-ai/dsh-workspace` 和 `dsh-codex-bridge/cli`，即可使用下面的命令。CLI 和用于打开导入结果的 Harness 必须指向同一个 Session 和 Workspace 数据集。

在专用 profile 的 `cordis.patch.yml` 中插入以下两项。把 `CLI_CONFIG` 换成[配置示例](P10_CLI_CONFIG_EXAMPLE.json)中的对象，并填写可信 Codex 可执行文件、启动目录和 Codex home。

~~~yaml
- insert:
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: codex-import-cli
      name: dsh-codex-bridge/cli
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
