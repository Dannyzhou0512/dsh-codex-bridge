# P1 Dev runtime smoke checklist

此清单只用于用户审核后独立的 <isolated-dev-home>。当前仅做项目侧验证；不连接 Codex、不读取历史，不运行 P2，不创建/修改 Session 或 Workspace。

## 前置条件

- 独立 Dev Desktop/CLI 的实际位置由用户确认，版本严格为 DSH 0.2.0-rc.2。不要默认使用 PATH 中可能指向正式安装的 dsh。
- 确认 Dev Desktop 启动实际采用 <isolated-dev-home>，并检查 Dev 日志/宿主路径报告；若仍指向正式 home，立即停止安装。
- 不修改 <installed-harness-directory> 或 <production-home>；不授权 allow-version；不要把测试依赖复制进 Desktop 资源树。
- 使用项目打包的 .artifacts/dsh-codex-bridge-0.0.1.tgz。此包无 client/adapter/导入命令，不能用于迁移。
- 正常 Dev Desktop 初次启动可能初始化它自己的 Session/Workspace/default registry；这不是插件的写入。比较必须在已经启动、稳定的同一 Dev baseline 上完成，不能归因为 importer 行为。

## 准备命令（仅供随后由用户执行）

先指定**已确认的 Dev CLI 绝对路径**；以下占位值必须替换。这些命令尚未执行，不代表已有可用 Dev 安装。

~~~powershell
$bridgeDevDsh = '<已确认的 Dev dsh 可执行文件绝对路径>'
$bridgeTarball = '<absolute-path-to-built-tarball>'
if (-not (Test-Path -LiteralPath $bridgeDevDsh -PathType Leaf)) { throw '请先确认 Dev CLI 路径' }
if (-not (Test-Path -LiteralPath $bridgeTarball -PathType Leaf)) { throw '请先完成项目打包验证' }
$bridgePreviousDshHome = $env:DSH_HOME
try {
    $env:DSH_HOME = '<isolated-dev-home>'
    $bridgeDevVersion = (& $bridgeDevDsh --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $bridgeDevVersion -ne '0.2.0-rc.2') { throw 'Dev CLI 版本不匹配，停止安装' }
    # 此步骤不能证明 Desktop 实际 home；仍须先完成前置检查。
    # 按官方 public CLI 安装 bundle；仅操作此独立 Dev home。
    & $bridgeDevDsh plugin --profile desktop add $bridgeTarball
    if ($LASTEXITCODE -ne 0) { throw 'Dev 安装失败，停止后续步骤' }
    & $bridgeDevDsh --profile desktop --dump-config
} finally {
    $env:DSH_HOME = $bridgePreviousDshHome
}
~~~

不要直接用上述占位路径运行。Desktop GUI 的 Dev 启动方法需按已确认的 Dev 安装确定；不能假设“只设置一次 shell 环境就改变已运行的正式 Desktop”。GUI 安装也可使用 Dev Plugin Manager 的 public install_bundle，操作前再次确认当前 profile 的 home。

## 验收顺序

1. 记录 Dev 的版本/home/profile、已有 Session/Workspace 的 public IDs/计数以及子进程/网络 baseline，不读取私有持久化。
2. 安装结果没有 incompatible-version、pending build 或额外核心 runtime 安装；只贡献 dsh-codex-bridge-host row，原 core rows 不变。tarball 不需要 prepare/postinstall。
3. Loader row active；普通 Desktop 页面可用。缺未来 capability 时插件应仍 active，不因为缺 sessions/persistence/query/workspace 注入而 pending 或失败。
4. 若 Dev 提供 public live service inspector，查看 codexHistory 只读 status/capabilities；如该 inspector 无法调用任意第三方方法，记录限制，不 patch 宿主来增加调试入口。P1 无 Remote RPC/UI/CLI 命令，不能假定这些存在。
5. 核对 actual peer routing：Cordis 用宿主 4.0.4，app-boot 版本锚为 rc.2。不要仅以文件名判断 singleton；使用 Dev 支持的 public package/resolution inspection。无法取得身份时标 pending；项目测试的 instanceof 证据不能代替 Desktop routing。
6. 不发送用户 prompt、不运行模型；插件启动没有 codex 子进程、历史扫描、连接网络、Session/Workspace/domain 变化。宿主其他插件活动与 P1 分开归因。
7. 用 Dev Plugin Manager 公开禁用本 bundle，确认行卸载且 codexHistory 消失，宿主仍可用；再启用确认恢复。服务注销由 Cordis fiber 管理。
8. 完全重启 Dev Desktop，确认 bundle 仍正确加载、普通启动正常，没有任何自动导入。
9. 如果有独立的错误版本 Dev 实例，可验证 preflight 禁用/拒绝 rc.2-only bundle，且其他宿主行继续。不在正式环境降级，不人为修改 Desktop runtime，不使用 allow-version。没有错误版本实例则保留此验收项 pending（项目侧已有 evaluator/真实 preflight 负例）。
10. 删除测试安装只走 Dev Plugin Manager / public dsh plugin remove，确认只删除本 bundle。不要手改 profile、资源树、SQLite 或 JSONL。

## 当前证据与仍需 Dev 验证

已完成：published rc.2 app-boot/Loader 的项目隔离 composition；built/tarball 加载、卸载、重载；Cordis instance identity；公开 preflight 负例；execution I/O 守卫；包内无宿主 runtime。

尚未完成：完整 Dev Desktop 安装、Host profile peer routing、实际 Desktop 重启/Plugin Manager 禁用/启用、宿主其他插件并存与真实版本拒绝。清单完成并由用户审核前，不进入 P2。

## 2026-10-08 实际执行结果

已通过真实 Dev Desktop 的插件加载、热禁用/启用、正常退出和完整重启后的加载。无需提供 token；全过程使用已登录 Desktop 的标准控件。详见 [P1_DEV_SMOKE_RESULTS](RELEASE_CHECKLIST.md)。

原准备命令中的 desktop --dump-config 被实际 CLI 拒绝，不能执行或作为证据；Electron 独占管理规则没有绕过。status/capabilities 的活跃 Host 直接调用、全量 Session/Workspace 差分和实际错误版本 Desktop仍未验证，报告已明确范围。

已安装 tarball 保持原 P1 hash，不因文档变化重打包；Dev 中本插件最终保留启用。当前停在 P1，等用户审核后再开始下一阶段。
