# P12：Client 历史业务 API 与边界

主包 dsh-codex-bridge 0.0.9 不变；独立 companion dsh-codex-bridge-ui 0.0.2。P12 使用已发布 rc.2 public services 和父包 public faces，未增加另一套 writer、CLI 参数解析或 private storage 访问。

## Wire API

| Remote | 参数 | 输出 | 写入含义 |
| --- | --- | --- | --- |
| codexBridgeUi/status | 无 | schemaVersion、companion/harnessVersion、sourceState、importEnabled、三项能力 presence | 不启动 reader，不调用 provider |
| codexBridgeUi/list | archived:boolean | rows 的 thread id/title/cwd/createdAtMs/updatedAtMs/status/counts:null | stable thread/list，仅公开 metadata |
| codexBridgeUi/preview | threadId:string | hydrated turns/messages/tools、messagesView category/text、losses/warnings/truncated | stable thread/read，公开转换预览；不创建 Session/Workspace |
| codexBridgeUi/review | selections:[threadId,remapCwd:null/string,acceptedLosses:string[]] | handle/digest/expiresAtMs、每项 sessionId/state/targetCwd/workspaceAction/losses/blockers/warnings | BatchImporter.plan，strict dry-run；只保存 Host 原计划 |
| codexBridgeUi/execute | handle:string,digest:string,dryRun:boolean | dryRun/state、逐项 state/sessionId/verified/mayHaveCommitted/reason/warnings | dryRun=true 零迁移 mutator；false 须配置启写+匹配审核+先通过 dry-run，再走既有 batch/importer |

参数必须明确传递，没有 executable/codexHome/args/raw RPC 参数。公开 generator 的顶层参数 object 是 strict；嵌套 DTO 可被 SDK decoder 去除未知字段，然后按 Host schema 检查 selection/路径/损失枚举。不能声称所有嵌套未知字段都被直接拒绝；额外字段不会成为 source launch config。RemoteResult 在 Client 显式解包。

## 底层复用与源码

| seam | 插件实现 | DSH rc.2 reference / public face | 原因 |
| --- | --- | --- | --- |
| 生成 RPC / binding | UI src/index.ts、scripts/build.mjs | packages/typert/{protocol,generator}/src/index.ts；packages/api/gateway/src/index.ts | 公共 Remote/bindTypertRemote/WorkspaceTypertGenerator，不手写 descriptors |
| stable source | UI src/runtime.ts → dsh-codex-bridge/codex | 父插件 src/codex/reader.ts；P2_PROTOCOL.md | 非 experimental list/read，丢弃 raw reasoning/private paths，不 resume source |
| planning / batch | UI src/runtime.ts → /planner、/batch | 父 src/planner/planner.ts、batch/batch.ts | 保留 in-process issuance、source/provider/target/path freshness、显式去重/串行选择 |
| Session writer | 同上 → /importer | packages/session/session-persistence/src/{index,handle}.ts；packages/core/session/src/index.ts | public create/append/flush/close/readback；sessions.get live guard；不触私有 JSONL/SQLite |
| workspace | 同上 → /workspace | packages/workspace/workspace/src/{index,entity}.ts | 只注册现存目录、create/reuse/attachSession，missing cwd 需 explicit remap，无 mkdir |
| UI registration | UI src/client/index.tsx、Page.tsx、HistoryPanels.tsx | packages/api/remotes/src/client/index.ts；packages/client/{ui-renderer,ui-layout,ui-sidebar,locale}/src/client/index.ts | public Remote/$mount/main/sidebar/locale；浏览器不载入 Node/importer |
| theme | companion CSS | packages/client/ui-theme/src/styles/design-platform.css / gradient-shadow-text.css | 使用真实 --dsw-alias-border-l2、label、hover、font tokens；暗色遵循宿主 presenter |

以上 public API 仍是 rc.2 pre-stable，只锁定 0.2.0-rc.2。presence 不代表 backend 健康；真正 plan/apply 会检查服务、公开 persistence.identity 和底层状态。Cordis ctx.get 返回的服务代理不能靠 JS object equality 绑定 provider，P12 使用公开 identity，不改 SDK。

## 生命周期 / 审批 / 资源

默认 source not configured / write disabled。可信管理员 profile 配置 reader；config 接受 enabled:true、reader:ReaderOptions、writeEnabled（默认 false），禁止预设 acceptedLosses。配置错误只返回 invalid-config，不启动 source、不让初始化抛出业务异常。

Host face 只静态引用 wire/config；业务 runtime 通过固定本地模块路径 lazy import，严格 TS 编译仍覆盖 runtime。这样避免 npm Core augmentation 进入 generator 的 facade 可达类型图，同时 runtime 缺失错误延迟到用户操作；不是伪造声明/关 strict/patch SDK。主包及 Core 仍 external peer，普通依赖仅 Zod。

全局每个 Host service 只允许一个操作，最大20 selections、8份 Host审核（超限淘汰最旧）、10分钟 TTL；预览100 messages，每项16k字符，总128k字符，显式 truncated；扫描最大500 metadata rows /20页；所有转换、target readback 和 batch另有 bytes/events上限。预览截断不改变完整转换；content limit 阻断，不默默只导入部分来源。

Host保存原 BatchPlan/planner；客户端只拿随机 handle 与一致性 digest。digest 不是认证，handle 是同一已认证 Host 内的短期 bearer capability，不声称按 user/peer 隔离。请勿将共享认证 Host 暴露给不可信用户。实际写入前一次性消费 handle；返回丢失/失败后重新 plan 识别 dedup/partial，不自动恢复或 rollback。编辑 selection/remap/losses 立即清除 UI 审核/dry-run确认。

卸载令 closed、abort pending、等待当前 batch/leaf 的 writer close 后关闭 reader。无浏览器后台轮询/自动扫描/模型消息。SDK生命周期/错误行为有真实测试；Windows installed Web smoke用 SIGTERM收尾，不冒称正常 Desktop退出。

## 操作配置示例（设计示例，未写入正式/Dev）

profile cordis.patch.yml 可更新 id=dsh-codex-bridge-ui 的 config。reader 为已验证 ReaderOptions，完整形状见主包 README/P2_PROTOCOL.md：executable、args、cwd、codexHome、clientInfo、limits、readLimits。使用可信 Codex App Server 命令；不要把模型 API key 或用户凭据放在 UI 参数里。

先在专用隔离 profile 验收。UI 正式安装、额外真实单条/批量和模型续聊仍须用户单独授权。cache=skip；原生冷列表可能先显示通用标题，打开后 hydration，不能据此改私有投影或添加假历史 assistant/tool attribution。
