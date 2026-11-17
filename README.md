# DSH Codex Bridge

在 DeepSeek Harness 中浏览 Codex 历史，把选中的会话导入到工作区，然后在 Harness 的原生会话里继续任务。支持预览、Dry-run、单条导入和批量导入。

当前预览版已在 Windows 上验证 **DeepSeek Harness 0.2.2-rc.3**。Codex App Server 的验收基线为 Codex CLI `0.169.0-alpha.11.1`。

| npm 安装包 | 用途 |
| --- | --- |
| [`@dannyzhou/dsh-codex-bridge@0.0.10`](https://www.npmjs.com/package/@dannyzhou/dsh-codex-bridge/v/0.0.10) | 主插件，负责读取、转换和迁移会话 |
| [`@dannyzhou/dsh-codex-bridge-ui@0.0.9`](https://www.npmjs.com/package/@dannyzhou/dsh-codex-bridge-ui/v/0.0.9) | 在 DSH 侧栏添加「Codex 历史」 |

## 1. 在 DSH 中安装

先在 DSH 的版本信息中核对 `0.2.2-rc.3`，也可以运行 `dsh --version` 查看。打开 **插件 → 添加插件**，安装源选择 **npm 官方源**。先粘贴主插件包名并安装，再打开一次同样的弹窗安装侧栏包。两个包要装在同一个 profile。

~~~text
@dannyzhou/dsh-codex-bridge@0.0.10
@dannyzhou/dsh-codex-bridge-ui@0.0.9
~~~

请保留完整包名和版本号。这两个版本发布在 npm 的 `preview` 标签下，使用上面的精确版本可以直接安装。

也可以在 Desktop 首次启动并初始化 profile 后，退出应用，再用 PowerShell 一次安装两个包。

~~~powershell
dsh plugin --profile desktop add '@dannyzhou/dsh-codex-bridge@0.0.10' '@dannyzhou/dsh-codex-bridge-ui@0.0.9' --ignore-scripts
~~~

如果 PowerShell 找不到 `dsh`，使用 DSH 安装目录下 `resources/runtime/cli/bin/dsh.cmd` 的完整路径。使用自定义 `DSH_HOME` 时，终端应与 Desktop 指向同一个目录。已安装旧 GitHub 预览包的用户按[升级说明](docs/USAGE.md#npm-预览包)更换两个包。

## 2. 配置 Codex 历史来源

退出 DSH，编辑当前 Desktop profile 的 `profiles/desktop/cordis.patch.yml`。默认 DSH 根目录是用户目录下的 `.dsh`，使用自定义 `DSH_HOME` 时，从自定义根目录进入。

在文件里找到 `id: dsh-codex-bridge-ui`，给它填入下面的 `config`。如果没有这条记录，把这段添加为 YAML 列表中的一项。文件目前只有 `[]` 时，可用下面的列表替换它。保留文件中其他插件的配置。

~~~yaml
- id: dsh-codex-bridge-ui
  config:
    enabled: true
    writeEnabled: false
    reader:
      executable: 'C:/Tools/Codex/codex.exe'
      args: [app-server]
      cwd: 'C:/Projects/example'
      codexHome: 'C:/Users/Example/.codex'
      clientInfo:
        name: dsh-codex-bridge
        title: Codex history import
        version: '0.0.9'
      limits:
        requestTimeoutMs: 30000
        shutdownTimeoutMs: 3000
        maxInFlight: 2
        maxFrameBytes: 16000000
      readLimits:
        pageSize: 50
        maxPages: 20
        maxThreads: 500
        maxItems: 10000
        maxJsonDepth: 64
~~~

把三个示例路径替换为你自己的路径。

- `executable` 填你信任的 Codex 可执行文件完整路径。在 PowerShell 运行 `(Get-Command codex.exe).Source` 可以查询 PATH 中的安装。
- `cwd` 填一个已存在的目录，用来启动 App Server。每条会话的迁移目标根据其原工作目录或手动映射决定。
- `codexHome` 填当前 Codex 保存历史时使用的目录。如果你为 Codex 设置了独立的 `CODEX_HOME`，填那个目录。

首次使用保留 `writeEnabled: false`，然后重新启动 DSH。[配置 JSON 示例](docs/UI_CONFIG_EXAMPLE.json)

## 3. 试跑、导入并续聊

1. 从侧栏打开 **Codex 历史 → 扫描历史**。找到目标会话，点 **预览**，核对标题和内容。
2. 点 **导入此会话**，核对目标目录和转换变化。原目录不可用时，填写一个已存在的绝对目录，再点 **重新检查**。
3. 先点 **仅试跑**。看到「试跑通过」后，确认目标目录合适。Dry-run 期间不会创建导入会话或工作区。
4. 要实际导入，退出 DSH，把同一配置中的 `writeEnabled` 改为 `true` 并重新启动。重新打开该会话的确认面板，点击 **接受上述变化并导入** 或 **确认导入**。
5. 看到「已导入并验证原生会话」后，从 DSH 左侧**目标工作区**打开该会话，在底部输入框继续任务。Codex 的旧回复在「对话」里标为「来自 Codex 的历史回复」。提示「这条会话已导入」时，可以直接打开已有会话。

迁移范围包括公开文本，以及可取得的工具信息和公开推理摘要。图片与附件可能会省略，具体以确认面板列出的转换变化为准。[批量导入与 Web 使用指南](docs/USAGE.md#ui) · [迁移限制](docs/LIMITATIONS.md)

## 常见问题

| 看到的情况 | 怎么处理 |
| --- | --- |
| 侧栏没有「Codex 历史」 | 确认两个包都安装在当前 profile，侧栏包已启用，然后重启 DSH。 |
| 页面提示「尚未配置来源」或「来源配置无效」 | 核对正在使用的 profile、`dsh-codex-bridge-ui` 配置和三个本机路径，再重启。 |
| 能扫描，但找不到某条会话 | 核对 `codexHome` 是否与原 Codex 使用的目录一致。会话已归档时，勾选「归档会话」再扫描。 |
| 只能试跑，无法实际导入 | 试跑后，确认目标无误，再在当前 profile 启用 `writeEnabled: true` 并重启。 |
| 试跑通过，但工作区里看不到会话 | 完成第 4 步的实际导入后，再到确认面板显示的目标工作区查找。 |

## CLI 和配套 Codex Skill

只用终端的用户可以安装主插件，在专用 profile 中启用 CLI，再执行扫描、预览和 Dry-run。[CLI 配置指南](docs/USAGE.md#cli)

在 Codex 中使用 `$dsh-codex-bridge` 时，先通过 Skill Installer 安装本仓库的 `skills/dsh-codex-bridge` 目录。Skill 会检查版本和 profile，并引导审核。实际迁移由 DSH 插件执行。[配套 Skill](skills/dsh-codex-bridge) · [兼容性流程](skills/dsh-codex-bridge/references/workflow.md#compatibility-before-history-access)

> 使用 $dsh-codex-bridge 检查版本兼容性，匹配后预览我选定的 Codex 历史并做 Dry-run。

## 从源码构建与测试

需要 Node.js ^22.19.0 或 >=24、npm 和 tar。先构建主包，再从 UI 目录安装开发依赖。验证使用隔离 profile 和合成历史。

~~~powershell
npm ci --ignore-scripts
npm run typecheck
npm test
npm run package:verified

Set-Location packages/client/dsh-codex-bridge-ui
npm ci --ignore-scripts
npm run typecheck
npm test
~~~

[发布验收](docs/NPM_PUBLISH_READINESS.md) · [架构](docs/ARCHITECTURE.md) · [字段映射](docs/API_MAP.md) · [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [MIT 许可](LICENSE)
