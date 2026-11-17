# npm 发布前验证

Windows · Node.js 24.20.0 · npm 11.19.0 · DeepSeek Harness 0.2.2-rc.3

本文件保留发布前的验收记录。两个包随后已发布到 npm 的 `preview` 标签，公开下载文件与第 4 节的 SHA-256 一致。用户安装步骤见 [README](../README.md#1-在-dsh-中安装)。[主插件 0.0.10](https://www.npmjs.com/package/@dannyzhou/dsh-codex-bridge/v/0.0.10) · [侧栏 UI 0.0.9](https://www.npmjs.com/package/@dannyzhou/dsh-codex-bridge-ui/v/0.0.9)

## 1. 包名迁移

| 原 npm 名称 | 目标 npm 名称 | 版本 |
| --- | --- | --- |
| `dsh-codex-bridge` | `@dannyzhou/dsh-codex-bridge` | `0.0.10` |
| `dsh-codex-bridge-ui` | `@dannyzhou/dsh-codex-bridge-ui` | `0.0.9` |

检查开始时 Git 工作区干净，分支为 `main`。已核对 GitHub 的 [V2 Windows 公开预览](https://github.com/Dannyzhou0512/dsh-codex-bridge/releases/tag/v0.0.10-preview.1)。它使用同一对版本号和非 scoped 包名，目标宿主仍为 DSH 0.2.2-rc.3。

两个 scoped 包采用 MIT 和 `publishConfig.access=public`。UI 对主包的 peer 精确固定在 0.0.10。本地开发继续使用相对 `file:../../..`，从仓库根包构建和安装。DSH SDK peers 保持精确 0.2.2-rc.3，Cordis 保持 4.1.0，React 保持 18.3.1。

宿主按 npm 名称加载 bundle 和模块。补丁中的 `name`、CLI 模块 specifier 和浏览器 ModuleLoader 注册名使用 scoped 名称。Cordis 行的 `id`、Remote 服务名、Slot ID、配置格式以及 Session ID 和导入回执的哈希命名空间继续沿用。旧预览升级操作见[使用指南](USAGE.md#npm-预览包)。

## 2. 修改文件

| 文件 | 用途 |
| --- | --- |
| `package.json`、`package-lock.json` | 更新主包名称和锁文件身份，保留 exports、版本、依赖版本和公开访问配置。 |
| `cordis.patch.yml` | 用 scoped 名称加载主插件，沿用原 Host 行 ID。 |
| `packages/client/dsh-codex-bridge-ui/package.json`、`package-lock.json` | 更新 UI 包名、主包 peer、相对主包开发依赖的锁条目，并补齐公开访问配置。此行后者位于同一目录。 |
| `packages/client/dsh-codex-bridge-ui/cordis.patch.yml` | 用 scoped 名称加载 UI Host，沿用配置使用的原行 ID。 |
| `packages/client/dsh-codex-bridge-ui/src/runtime.ts`、`src/client/HistoricalReply.tsx`（同一 UI 包） | 更新 Host 运行时导入和 Client 类型导入。现有构建脚本从 manifest 读取 UI 包名，生成对应的 Host/Remote 与客户端模块。 |
| `packages/client/dsh-codex-bridge-ui/scripts/build.mjs`、`.gitignore` | 将生成器需要的公开 Typert 协议源码复制到忽略的同级分析目录，避免 scoped 名称改变项目排序后，生成器将协议声明误归到 UI 包。运行时仍从宿主解析协议。 |
| `packages/client/dsh-codex-bridge-ui/tests/package.test.mjs` | 核对实际归档的名称、精确 peer、导出文件、补丁 ID 和浏览器注册 ID，保留浏览器隔离断言。 |
| `scripts/verify-package.mjs` | 验证实际 scoped 归档，从最近打包清单选取默认归档，并按 scope 解包到独立加载目录。 |
| `tests/helpers.mjs`、`tests/artifact.test.mjs` | 调整测试插件落盘路径及预期的 Cordis 模块名。 |
| `tests/fixtures/loader-process.mjs`、`preflight-process.mjs`、`side-effects-process.mjs`、`p3/host-config.mjs`（均位于 fixtures 目录） | 用 scoped 模块名继续验证启动、准入、卸载和副作用边界。 |
| `tests/fixtures/batch-artifact-process.mjs`、`codex-artifact-process.mjs`、`converter-artifact-process.mjs`、`importer-artifact-process.mjs`、`planner-artifact-process.mjs`、`recovery-artifact-process.mjs`、`workspace-artifact-process.mjs`（均位于 fixtures 目录） | 通过 scoped 包的实际 exports 加载模块，保留已有业务断言。 |
| `tests/fixtures/p4-host-process.mjs`、`p5-host-process.mjs`、`p5-readonly-process.mjs`、`p6-host-process.mjs`、`p7-host-process.mjs`、`p8-host-process.mjs`、`p9-host-process.mjs`、`p10-launch.mjs`（均位于 fixtures 目录） | 更新真实 SDK 集成夹具和 CLI 启动夹具的 scoped 模块及 bundle 路径。 |
| `README.md`、`docs/USAGE.md`、`docs/RELEASE_CHECKLIST.md`、`packages/client/dsh-codex-bridge-ui/README.md` | 说明 GitHub 旧包与 npm 新包的安装、配置和升级入口，并链接发布报告。 |
| `docs/NPM_PUBLISH_READINESS.md` | 保存实际验证结果、归档信息和市场提交材料。 |

## 3. 构建与自动化测试

所有安装都启用 `--ignore-scripts`。测试仅使用合成历史和隔离模型夹具。完整本机日志在 `.artifacts/npm-readiness-logs/`。

| 目录 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 根目录 | `npm ci --ignore-scripts` | PASS | 从锁文件和本地缓存重试，退出 0，安装 714 个包。首次在线运行因耗时被主动结束。 |
| 根目录 | `npm run typecheck` | PASS | TypeScript 退出 0。 |
| 根目录 | `npm test` | PASS | 167/167，含真实 DSH launcher、确定性 ID、Dry-run、写入恢复、批量及去重。 |
| 根目录 | `npm run package:verified` | PASS | 实际解包加载 scoped 归档，并用公开 SDK 验证原生导入、读回、恢复和去重。 |
| 根目录 | `npm run check:publish` | PASS | 工作树文本、敏感路径模式和锁文件的相对路径检查通过。 |
| UI 目录 | `npm ci --ignore-scripts` | PASS | 按锁文件校验完整性并补齐 UI 缓存后重试，退出 0，安装 80 个包。 |
| UI 目录 | `npm run typecheck` | PASS | 修复 Typert 归属后，Host/Remote、Client factory 生成和 TypeScript 检查均退出 0。 |
| UI 目录 | `npm test` | PASS | 13/13，含实际 UI 归档、Remote Gateway、浏览器注册、断线重试和写入审核。 |
| 根目录 | `npm publish --dry-run --access public --tag preview --json` | PASS | npm 输出 public 和 preview，归档 SHA-1 与已检查的文件一致。 |
| UI 目录 | `npm publish --dry-run --access public --tag preview --json` | PASS | 同上，UI 构建状态行后面的 npm JSON 可解析。 |
| 根目录 | `git diff --check` | PASS | 工作区补丁格式检查。 |

UI 的首次锁文件自动更新在离线缓存缺项时返回 `ERESOLVE`。此次采用原锁文件的依赖图，仅迁移包身份和本地依赖条目，后续 `npm ci` 通过。首次 UI 安装因缓存缺少锁定的 semver tarball 返回 `ENOTCACHED`。首次 UI 类型检查返回 `TypertAnalysisError`，指向 `typertRemote` 成员。DSH 的生成器按包名排序并选择第一个包含路径的分析项目，新 scope 使嵌套的协议项目失去正确归属。将协议分析移到同级目录后复测通过。保留原 Remote 契约、版本约束和测试断言。失败日志见 `ui-1.log`、`ui-retry-2.log`。

## 4. npm 发布包与安全性

本机归档路径相对于仓库，两个文件均是实际验证对象。

| npm 包 | 归档及大小 | SHA-256 |
| --- | --- | --- |
| `@dannyzhou/dsh-codex-bridge@0.0.10` | `.artifacts/package-main-DfgX9K/dannyzhou-dsh-codex-bridge-0.0.10.tgz` · 111 项 · 89,159 字节 | `7c54f78dc2c8e8912f20999f65cb5ffca351aa7208ba7b4c6c7079c2f1456b91` |
| `@dannyzhou/dsh-codex-bridge-ui@0.0.9` | `.artifacts/package-ui-ifsPvF/dannyzhou-dsh-codex-bridge-ui-0.0.9.tgz` · 25 项 · 145,038 字节 | `44856618ac887c753435ab3b707a505f156f67ce9dce420229800d8dd1065597` |

- **PASS** · 两个归档含 MIT LICENSE、README、有效 `dsh.bundle.patch`、`main`、类型声明和全部导出入口。UI 还含 scoped ModuleLoader factory 和 Host/Remote 产物。
- **PASS** · 归档逐项审查未发现测试历史、`node_modules`、临时文件、私有日志、凭据模式或本机敏感路径。UI 的声明映射使用相对路径。主包普通依赖只有 Commander 和 Zod，UI 只有 Zod。DSH、Cordis 和 React 由宿主 peer 路径提供。
- **PASS** · 浏览器仅调用定型 Remote。配置可信的 App Server 命令、参数和 Codex home 的能力保留在 Host profile。实际写入默认关闭。单条导入保留确认后自动试跑及复核，批量导入保留逐项审核、Dry-run 和显式写入确认。导入只经宿主公开 Session/Workspace 服务，路径映射要求现存目录。
- **PASS** · 对两个 scoped 名称做公开 npm registry 只读查询，都返回 404，当前未发现公开的同名包。npm 账号的写入权限仍需在正式发布时核验。

## 5. DSH 兼容性

隔离测试目标为已安装的 Windows DSH 0.2.2-rc.3，SDK 版本约束仍由宿主检查。Web 使用全新的 `DSH_HOME`、临时 loopback npm registry、独立包管理缓存和独立浏览器目录。Desktop 使用单独的 `DSH_HOME`、Electron 用户数据目录和 AppData。两边都使用仓库内合成 App Server，只调用公开只读历史方法。宿主启动可初始化自己的隔离数据。Dry-run 的零写入检查针对 Session 和 Workspace 迁移。

| 项目 | 结果 | 观察 |
| --- | --- | --- |
| 版本准入 | PASS | 两个 manifest 经公开 SDK 检查均适配 0.2.2-rc.3，且会拒绝 0.2.0-rc.2、0.2.1-rc.5 和 0.2.2。实际安装同样通过，未使用版本豁免。 |
| Web 按 npm 名称安装、启动、主插件注册、侧栏加载 | PASS | 公开 DSH Plugin Manager 按两个精确 scoped 版本从临时 registry 下载实际 tarball。合成 profile 只下载两个插件和两个普通依赖，实际加载了两个 bundle。 |
| Web 缺配置、配置无效、App Server 进程断线 | PASS | 无配置时安全提示且没有扫描入口。错误配置有明确提示。合成 App Server 异常退出时显示操作失败，扫描入口仍可重试。 |
| Web 扫描、预览、转换审核、Dry-run | PASS | 公开历史分页扫描和预览通过，可以核对目标工作区。缺省配置没有实际导入按钮，Dry-run 通过，同一目标后续仍可创建首条 Session，试跑阶段未创建 Workspace。 |
| Web 实际导入、重启读回、去重 | PASS | 显式允许写入后导入一条合成原生 Session 并关联 Workspace。结束并重启宿主后能从工作区打开原生会话，看到用户文本和带来源的 Codex 回复。复核时识别已导入且无可执行写入按钮。 |
| Web 卸载及卸载后启动 | PASS | 通过公开 Plugin Manager 移除两包。启动后，Codex 历史入口已消失，已导入 Session 的 Workspace 仍可见。 |
| Electron Desktop 窗口 | PASS | 从实际 tarball 安装两个包，在侧栏发起合成导入，打开工作区内会话并读到历史回复。重启后再次打开，复核显示已导入。三个测试进程均正常退出，退出码为 0。 |
| 正式 profile、真实 Codex 历史、真实模型与远程 registry 下载 | NOT TESTED | 本轮使用项目内隔离 profile、合成历史与模型夹具。公开 registry 的下载和索引收录需在授权发布后验证。 |

隔离环境的 `pnpm peers check` 会报告它在 profile 的 node_modules 中未看到 DSH SDK、Cordis 与 React。这些依赖由 DSH 启动器解析，Web 和 Electron 实机加载、Remote 调用与原生写入均已验证。诊断未报告 scoped 主插件 peer 缺失或版本冲突。普通 npm 进程还需要适当的宿主依赖环境。

工具沙箱内的首轮 Electron 启动被 Windows 安装目录 ACL 拦截。随后用同一已安装的 Electron 在工具沙箱外运行独立 profile 通过，测试退出后未保留运行中的 Desktop 测试进程。安装目录、ACL 和正式 profile 均未修改。

本机验收证据为 `.artifacts/npm-readiness-dsh-oA7xbG/result.json`（Web）与 `.artifacts/npm-readiness-desktop-UwMUcN/desktop-preview-report.json`（Desktop）。

## 6. 遗留风险

本地验证未发现阻碍此次 npm `preview` 发布的问题。公开下载、账号授权和市场收录属于发布后的验证项或需要单独授权的步骤。

- `preview` 是 npm dist-tag。两个版本仍为普通 semver。只发布到 `preview` 时，客户按确切版本或显式 `@preview` 安装。无版本安装通常使用 `latest`。
- 本仓库 GitHub 的旧包属于另一对 npm 身份。已有用户须按[升级步骤](USAGE.md#npm-预览包)更换同一 profile 的两份插件。会话身份、已有回执和实例 ID 继续沿用。本轮没有向生产数据执行升级。
- 迁移边界保持既有的公开 App Server 数据范围、文件映射及故障恢复限制。[限制说明](LIMITATIONS.md)

## 7. 预览发布命令

以下命令供人工授权后执行，本轮只执行了 Dry-run。先在仓库根目录发布主包，确认 npm 返回确切版本后，再进入 UI 源码目录发布侧栏包。

~~~powershell
# 仓库根目录
npm publish --access public --tag preview
npm view '@dannyzhou/dsh-codex-bridge@0.0.10' version

# 确认主包可取后，在同一个 PowerShell 窗口进入 UI 目录
Set-Location 'packages/client/dsh-codex-bridge-ui'
npm publish --access public --tag preview
npm view '@dannyzhou/dsh-codex-bridge-ui@0.0.9' version
~~~

也可以把第 4 节校验过的 `.tgz` 作为 `npm publish` 的位置参数，依照相同顺序发布这两个确切归档。发布前核对当前 npm 账号为 `dannyzhou` 和目标 registry 为 npm 公共 registry。发布后用 `npm view <包名> dist-tags --json` 检查 `preview` 是否指向预计版本。[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) · [dist-tag 文档](https://docs.npmjs.com/adding-dist-tags-to-packages/)

## 8. DSH 市场收录准备

两个包在公开 npm 可按精确版本获取后，可各提交一份社区收录申请。申请中标明 UI 依赖及同 profile 安装要求，便于维护者复核。由索引维护者审核、生成和部署索引，用户需要订阅该索引后才能从 DSH「发现」查找。发布到 npm `preview` 或 `latest` 均无法单独触发收录。请维护者确认该索引如何标注预览版及指定确切 npm 版本。[社区收录表单](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml) · [DSH 插件索引指南](https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market)

| 表单字段 | 主插件 | 可选侧栏 |
| --- | --- | --- |
| 插件地址 | `@dannyzhou/dsh-codex-bridge` | `@dannyzhou/dsh-codex-bridge-ui` |
| 简短说明 | 将审核过的 Codex 公开历史迁移到 DeepSeek Harness 原生 Session，支持试跑、工作区映射和重复导入识别。 | 在 DeepSeek Harness 侧栏浏览、预览和审核 Codex 历史，支持单条和批量导入。 |
| 补充信息 | 0.0.10，Windows，DSH 0.2.2-rc.3，MIT。主包测试 167/167，合成原生导入与重启去重通过。 | 0.0.9，Windows，DSH 0.2.2-rc.3，MIT。需同 profile 的主包 0.0.10。UI 测试 13/13，隔离 Web 与 Desktop 完成合成导入和读回。 |
| 源码 | [GitHub 仓库](https://github.com/Dannyzhou0512/dsh-codex-bridge) | [同一仓库的 UI 子目录](https://github.com/Dannyzhou0512/dsh-codex-bridge/tree/main/packages/client/dsh-codex-bridge-ui) |

实际 npm 发布、Git 推送、GitHub Release 与市场提交均未执行。
