# API 调研与字段映射

调研日期：2026-10-07。目标仅为 DeepSeek Harness（DSH）**0.2.0-rc.2**。初始结论来自源码阅读和官方协议文档。P1 bundle/Dev smoke 已通过；P2 公开只读协议已验证（见文末补充），P3 合成原生 Session 的续接证据见文末；真实 Codex 导入尚未实现。

## 证据与公开性

源码根目录：独立、只读的 DeepSeek Harness rc.2 源码参考快照（不随本仓库分发）。以下源码路径均相对此目录。根 package.json 与 session、session-persistence、workspace manifest 声明 0.2.0-rc.2；未通过 Git 操作验证 tag/工作树，因此依据是本地这份快照。参考目录未运行安装、构建、迁移、格式化或 Git 命令。

参考仓库 AGENTS.md 明确写出“Public APIs are pre-stable”。本文的公开指 Service Definition、包导出或声明的扩展点，**不能解释为跨版本稳定承诺**。即使 manifest 导出 ./src/*，插件也不能因此使用包内 private helper。

## DSH 服务与方法

| 服务/能力 | 对应源码路径 | 关键接口 | 用途、限制与公开性 |
| --- | --- | --- | --- |
| Host ctx.sessions / SessionStore | packages/core/session/src/index.ts | create(id?,options?)；prepare/enter/announce；get/list | 公开内存注册服务，pre-stable。**create 不持久化**；不用于冒充 durable importer。导入时不发布临时 live Session，以免触发宿主观察者 |
| Session | 同上；packages/core/session/src/types.ts | Session.create(id,seed?,header?,inheritedEventCount?,projections?)；append(type,data,opts) | 公开，pre-stable。detached replay 可预校验；append 自动分配 seq/time，消息事件必须 surfaceOp。历史导入采用自身持有的 typed event 数组以保留可用原时间 |
| sessionPersistence capability | packages/session/session-persistence/src/index.ts | create(header,options?)；open(id,'read'或'write',options?)；stat/list/flush；identity | 公开 Service Definition，宿主提供 backend。create 原子拒绝重复 ID 并给调用方独占 writer；stat/list 用于发现与去重，不选择自己的 JSONL/SQLite backend |
| SessionHandle | packages/session/session-persistence/src/handle.ts | read(offset?,length?,options?)；append(events,options?)；flush(options?)；close() | 公开，pre-stable。seq 必须接续末尾；append 只保证本实例可见，**flush 才是 durability barrier**。close 也会排空写入，不能作为 rollback。没有 delete/header update/整体事务 |
| 持久化校验 | packages/session/session-persistence/src/storage-contract.ts | 根包导出的 assertContiguous、materializeAppendBatch、validateStoredEvents 等 | 公开导出；不 deep import。检查 lossless JSON、连续性与已知事件；未知纯信息事件必须 ignorable:true。不是完整 turn/tool 关系验证 |
| Header / event vocabulary | packages/core/session/src/types.ts | SESSION_FORMAT_VERSION=4；SessionId/SessionSeq/SessionLogOffset；SessionEventMap；surfaceOp | 公开，pre-stable。普通迁移 isSeeded:false，不带 parentSession/origin。seed 输入不等于 fork lineage |
| 原生消息 | packages/llm/llm/src/message.ts、types.ts、brand.ts、assistant-stream.ts | UserMessage、AssistantMessage、ToolResultMessage；MessageId/ToolCallId；AssistantStreamRecord | 公开词汇，宿主 peer/type imports。每条消息必须 id/content/source；assistant.source 必须 provider/model；工具结果必须 callId 匹配 |
| sessionController | packages/api/session-controller/src/index.ts、types.ts | create({workspaceId?,cwd?,sessionId?,agentPreset?})；resolveAgent(id)；list/page/rename | 公开 Host/Remote 服务，pre-stable。**create 没有 seed/events 参数**。用于验证原生打开/续聊；dry-run 不 create/resolveAgent |
| Controller 恢复限制 | packages/api/session-controller/src/agent.ts、list.ts | inspectApiSession、resumeObserved、createOrAdopt、cold list | 私有实现，只读证据，不 import。cold header 没有 cwd 被跳过/拒绝恢复；createOrAdopt 包含 recursive mkdir，不能借它创建缺失历史目录 |
| WorkspaceRegistry | packages/workspace/workspace/src/index.ts | ctx.workspaceRegistry.create(path,title?)；list/get | 公开服务，pre-stable。create 只接受已有完全限定目录，realpath/stat 后按规范路径复用。不调用会 mkdir 的 initializeDefault |
| Workspace consumer interface | packages/workspace/workspace/src/types.ts | attachSession(id)；sessionIds；status() | 公开，pre-stable。新关联验证 session.header.cwd 与 workspace.path 同一既有目录；unknown/no cwd/missing/mismatch 拒绝；membership 持久化 |
| Workspace 路径规则 | packages/workspace/workspace/src/paths.ts、entity.ts | fullyQualifiedWorkspacePath、realpathNormalize、attachSession 实现 | 包内实现，不能作为插件 import seam。Windows 拒绝 drive-relative 和仅根斜线；realpath 后字符串相等；插件以 registry 返回结果为权威 |
| sessionQuery | packages/session-query/session-query/src/index.ts | listSessions/readSession/readSurface；observeSession(id,{projectionMode:'none'}) | 公开，pre-stable。用于原生读回/replay/surface 检查，observation lease 要 dispose。dry-run 优先 persistence read，避免缓存写回 |
| Query 新鲜度 | 同包 corpus.ts、observation.ts；packages/session-query/session-query-sqlite/src/index.ts | listing 合并 live/persisted；stat revision；search 前 reconciliation | 私有实现证据，不调用 _reconcile。没有需要插件调用的 public sessionQuery.refresh；新 listing 重新读取持久化记录 |
| sessionProjections | packages/session/session-projection/src/index.ts | register/snapshot/restore/hydrate | 公开投影 seam；live 监听 session/event。直接 handle.append 不发 session/event，不能假定 UI/cache 会同步 |
| sessionProjectionCache | packages/session/session-projection-cache/src/index.ts | cachedSnapshot、hydratePrepared、coldSnapshot(meta,cut,events)、write(session) | 公开方法，pre-stable。coldSnapshot 可正式导入后预热并异步写缓存；dry-run 不调用。缓存失败不能回滚 durable Session |
| Session 标题 | packages/session/session-title/src/index.ts、types.ts | session/title；normalizeSessionTitle；source/messageSeqs | 公开事件/导出，pre-stable。没有 header.title。预览选择“保留并固定标题”后用 source.kind=user、messageSeqs=[]；这是用户接受固定标题，会停止自动生成 |
| 插件自有 ledger | packages/storage/storage-domain/src/index.ts | ctx.storageDomain.open(spec)；domain/table/close | 公开 seam，pre-stable。可选独立 remap/result domain，不碰宿主私有表。首次 open 会初始化，dry-run 不 open；schema/routes 尚需验证 |
| Host 注入 | 已有服务的 static inject/apply；vendor/cordis/package.json | inject、ctx.inject、ctx.effect、ctx.on | 公开 Cordis seam。宿主 Cordis 版本为 4.0.4；注册/子进程清理归 fiber；不在启动时扫描或导入 |
| CLI/command | packages/boot/cmdline/src/index.ts；packages/interaction/commands/src/index.ts | cmdlineArgs.get、parseCmdline、appReady/appExit；commands.register({name,handler,...}) | 公开，pre-stable。应用经 dsh profile 启动，不能包内自带 Harness runtime/bin。slash command 框架会记录运行事件，不能用它承诺整个 Session dry-run 零写入 |
| Host/Client RPC | packages/typert/protocol/src/index.ts；packages/api/gateway/src/index.ts、src/client/index.ts | TypertRemoteService、@Remote；Client ctx.remote.$mount(contribution) | 公开，pre-stable。自有 namespace；gateway 有 SRC discovery 和 strict descriptor 路径；第三方发布产物必须独立验证 |
| RPC 生成 | packages/typert/generator/src/index.ts、package.json | WorkspaceAnalyzer、FaceModelEmitter、WorkspaceTypertGenerator；./tsdown | published API，pre-stable；外部 minimal build 未验证，不能直接依赖 repo 内构建 helper |
| bundle/profile | docs/user/develop/basic/publish.md；packages/boot/app-boot/src/profile.ts | dsh.bundle.patch；profile dsh.profile.bundles；YAML insert patch | 有文档的公开安装格式。独立 bundle 只 insert 自有行，不覆盖 core 行，不 patch Harness 源码 |
| peer 共享/拒绝 | packages/boot/app-boot/src/profile-resolution/resolver.ts、plugin-compatibility.ts、compatibility-preflight.ts | peer lookup 使用 runtime resolution；DSH peer semver(includePrerelease:true) | 宿主公开行为，实现文件不由插件调用。状态型核心放 peer+dev，精确 rc.2；不用 allow-version 规避不匹配 |
| Client 加载 | packages/client/modules/src/index.ts、src/client/manifest.ts | dsh.client.platform/inject/external；exports['./client'] | 公开 manifest/seam。Host 扫描 active package，生成 module graph；dsh.client.inject 是包名，Client inject 是服务名 |
| Sidebar/main 页面 | packages/client/ui-sidebar/src/client/index.ts、contract/slots.ts；packages/client/ui-layout/src/client/index.ts；packages/client/ui-plugin-manager/src/client/index.ts | slots.inject/register；sidebar.panellist(id)；main(key)；layout.selectPanel | 公开 slot，pre-stable；同一自有 panel ID 贡献导航与页面，实际插件管理页面可作为模式证据，不替换 sidebar.workspaces |
| Client Session 刷新 | packages/api/session-controller/src/client/contract/sessions.ts、sessions/service.ts | Client ctx.sessions.refresh()、refreshProjections(id) | 公开 Client face。与 Host SessionStore 同名但接口不同；导入后刷新原生列表/投影 |
| Desktop profile | apps/desktop/src/project-manager.ts、runtime-tree.ts；app-boot profile/resolver/preflight | external plugin profile；hoisted、autoInstallPeers:false；disableAllPlugins recovery | 存在第三方兼容机制；资源树和用户插件 profile 分开。Desktop 类不是插件 public API；独立安装/启动仍待隔离 smoke |

snapshotEvents、eventAt、ownEvents 已弃用且源码禁止新增调用。插件用自己持有的转换数组及 public query/handle 读取，不为取得历史使用这些同步 getter。session/end-seed 只能由 Session constructor/buildForkSeed 生成，插件不得自行 append。

## bundle/peer 示例（仅设计，不创建配置文件）

Host manifest 应有 type:module、根 Host export、package.json export、files 清单与 dsh.bundle:{patch:'./cordis.patch.yml'}。patch 是 YAML 数组：

~~~yaml
- insert:
    - id: dsh-codex-bridge-host
      name: dsh-codex-bridge
~~~

只插入自有行；CLI startup 只用于专属 importer profile。可选 UI 推荐独立 companion bundle；Host 包不声明 dsh.client，避免坏 UI asset 影响 Host-only 用户。

第三方不能照抄 workspace:*：monorepo 发布才转换该范围，宿主 evaluator 又把它解释为当前 runtime，不能限制 rc.2。所有实际 import 的 DSH peers 精确声明 **0.2.0-rc.2**，例如 @deepseek-ai/dsh-session、dsh-session-persistence、dsh-workspace、dsh-session-query；其他 DSH 包逐一补全。@deepseek-ai/cordis 单独声明 **4.0.4**，不能用 DSH 版本。devDependencies 用相同版本；运行时 DSH/Cordis imports external，不内联。

编译期 type import、宿主 peer runtime import、dependencies 打包是不同关系。需要验证真实解析身份和 tarball，不只看 manifest。不能把 session/workspace/storage/llm 等另一版本运行时作为普通 dependencies。

## Codex 稳定历史读取

官方依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。本次获取的文档将 thread/list 和 thread/read 列在稳定范围，把 thread/turns/list、thread/items/list 明确标为 experimental；不能因为 main 代码有方法就当作稳定发布接口。

数据流：initialize request → initialized notification（experimentalApi=false）→ thread/list 的 nextCursor 分页 → 选中 thread → thread/read(threadId,includeTurns:true) → thread.turns[].items[] → 过滤后的 snapshot → converter。

扫描显式 sourceKinds 覆盖 cli/vscode/appServer，避免默认筛选漏掉 app-server 来源；archived 与非 archived 分别分页、合并去重。list 的未加载 turns 不能作为精确计数；预览完整 read 后才统计。不同 server/home/远程来源的可见性要实测。

不调用 thread/resume、turn/start 或历史修改方法，不读取返回的私有 history path。稳定完整 read 不可用时拒绝该会话，不自动启用 experimental，不读 SQLite/rollout/桌面内部状态。未来公开 API 可变，实际 Codex 版本要锁定 schema。

后续获准阶段可用官方 generate-ts/generate-json-schema 将 schema 输出到插件目录，匹配实际二进制。当前未运行 App Server 或生成 schema。

## Thread / Turn 字段映射

| Codex 字段 | 插件/DSH 字段 | 规则 |
| --- | --- | --- |
| Thread.id | sourceThreadId；SessionHeader.id | codex- + SHA-256('dsh-codex-bridge/v1\0'+id) 完整 hex；不包含 cwd/title/updatedAt |
| Thread.name；preview | previewTitle；session/title.data.title | name 优先；preview 仅派生展示标题，不能当正文。规范化和截断展示在 plan；保留原值于信息 receipt |
| Thread.cwd | originalCwd；header.cwd；Workspace.path | 本机既有完全限定目录才关联；header.cwd 用选定路径的 realpath。缺目录→needs-remap，先映射后创建 Session |
| Thread.createdAt/updatedAt | sourceCreatedAtMs/sourceUpdatedAtMs；header.createdAt | 文档 Thread 示例为 Unix 秒，按实测 schema 安全乘 1000。header 没有 updatedAt；后者留 receipt |
| Thread.status.type/activeFlags | sourceStatus、eligibility | notLoaded 不是失败；active 默认暂缓。systemError 显示诊断，已结束历史可转性另判；不恢复 Codex 活跃/审批状态 |
| Thread.ephemeral | eligibility | ephemeral 或无可读 durable 历史不导入 |
| Thread.modelProvider | provenance.provider | 当前 Thread 配置不能证明每条历史回复的归因；不能直接套给全部 assistant |
| 可公开获得的逐项 model attribution | assistant.source.provider/model | 稳定 read 未保证此数据；不得假定 Thread.model/Turn.model 必然存在。缺证据→needs-review 或显式 recall 降级 |
| Thread.turns | turnCount、遍历顺序 | hydration 后统计；按实测历史顺序，不按 ID 字典序 |
| Turn.id | receipt.turnId、Message ID namespace | DSH turn 使用从 1 开始的连续整数，Codex ID 保留为来源 |
| Turn.items | itemCount/messageCount/toolItemCount | messageCount 仅 userMessage/agentMessage；summary/tool/plan 单独计。未加载显示未知而非 0 |
| Turn.status/error | turn/end.data.reason | completed→{kind:'completed'}；interrupted→{kind:'interrupted'}；failed→{kind:'error',error:{message,code:'CODEX_TURN_FAILED'}}；inProgress 默认不转 |
| 公开 turn/item 时间（如存在） | SessionEvent.time | 当前未确认逐项时间；无值则以 thread.createdAtMs 作 deterministic synthetic time，在 receipt 标记。不能由 durationMs 推导绝对时间 |

## Message / Tool 到 SessionEvent

统一 envelope：{type,seq,time,data}，seq 从 0 连续。消息事件有 surfaceOp:'append'；边界/信息事件不带 surfaceOp。Message ID 基于 threadId+turnId+itemId+角色/分段的 deterministic hash，不随机生成；重复/缺 item ID 要拒绝或按锁定 schema 明确索引政策并标注。

faithful 表示公开证据足够构成原生角色。recall 表示将公开历史保存为带来源的原生上下文消息，仍可继续使用，不能宣传为原角色无损恢复。缺模型身份时不编造 openai/unknown 等 route。

| Codex item | DSH 具体字段 | V1 政策/限制 |
| --- | --- | --- |
| userMessage.id、content[].text | user/message.data={id,role:'user',source:{kind:'user'},content:[{type:'text',text},...]} | 文本按顺序保留，不转成 system prompt |
| userMessage 非文本 input | 需宿主 attachment capability 的 image/file block | V1 无公开安全附件导入能力时 strict 拒绝；用户明确接受 text-only 损失才使用标注占位。不读取任意历史私有附件路径 |
| agentMessage.id/text/phase | assistant/message.data={turn:n,step:k,message:{id,role:'assistant',source:{kind:'model',provider,model},content:[{type:'text',text}]},stream:[]} | provider/model 需逐项可靠证据；stream=[] 表示无原流，不编造 delta/usage。phase 留 audit，不当 role。空 stream 全链路待验证；缺 attribution 用 recall 或 needs-review |
| reasoning.id/summary | 独立 recall user/message，category=reasoning-summary | 明示公开摘要，不当原始 reasoning block。content/raw reasoning/textDelta/encrypted 不迁移，从 adapter 输出就排除 |
| commandExecution 的 command/cwd/status/aggregatedOutput/exitCode/durationMs | recall user/message，category=tool，文本序列化允许字段 | 保留 tool 信息，缺 output 明示未提供；不运行命令、不因 tool.cwd 改 Session cwd |
| fileChange 的 changes[].path/kind/diff/status | recall user/message，category=file-change | 不 apply patch、不重建文件，不检查历史文件正文 |
| mcpToolCall 的 server/tool/arguments/status/result/error | recall user/message，category=mcp-tool | 不映射同名 DSH executable tool；不自动读取 result URI；不杜撰成功 |
| dynamicToolCall 的 tool/arguments/status/contentItems/success/durationMs | recall user/message，category=dynamic-tool | 只保留公开信息；缺结果不生成假 tool/result |
| plan.text、webSearch.query/action、已知 review/collab 信息 | recall category 或仅预览 warning | allowlist 与实测 schema 一致；不当 DSH 已完成计划或 subagent lineage |
| contextCompaction | audit/warning | 不生成 DSH surface replace；不能声称重建 Codex 压缩后的模型上下文 |
| 未知 item.type | unsupportedTypes/warning | 默认 needs-review；不整包透传、不默默丢语义，明确接受有损后才处理可用部分 |

recall 的原生字段为 user/message.data={id,role:'user',source:{kind:'codex-history',form:'recall',threadId,turnId,itemId,category,originalRole},content:[{type:'text',text:公开正文/工具信息}]}。插件声明 MessageSourceMap 自有 kind，但写入的是 core user/message，不需要自定义 message projection。卸载后是否仍可安全读回/续聊需真实 rc.2 runtime 测试。

完整 native tool 重建若未来可行，必须同时有：
assistant/message.content 中的 {type:'tool-call',id:callId,name,arguments:JSON字符串}；
tool/call.data={turn,step,callId,name,arguments}；
tool/result.data={turn,step,message:{id,role:'tool',source:{kind:'tool',callId},toolCallId:callId,content,isError?}}。
三处 callId 相同，位于同一 open step；error 详情仅在 message.isError=true 时允许。

单个公开 commandExecution/MCP item 不能证明原始 assistant call block、stream、历史 tool schema 都能恢复。V1 采用工具信息 recall；native tool 重建不作为承诺，也不导入 OpenAI request/header 覆盖 DSH 后续模型配置。

每个已结束 turn 编号 1..N，turn/start→按 item 顺序消息→turn/end。faithful assistant 每项用连续 step：step/start→assistant/message→step/end；step 是导入的规范分段，不等于 Codex 内部 call。P3 证实首个 turn 必须有合法 step 容纳空 system head；该规范分段不宣称原 Codex 模型调用。后续纯 recall turn 的 step 政策仍需 converter 验收。参考 session invariant：turn/step 从 1 开始、不能交叠、tool/result 需要此前同 step 的 call。detached 校验不替代完整关系测试。

## 查询、投影与 UI 刷新

direct handle 写入不发 session/event；不能伪造 session/created、api-session/added 去通知 UI。flush/close→public readback→attach；正式导入后可用 public cache.coldSnapshot 预热，Client sessions.refresh/refreshProjections 更新列表。query listing/revision/search 已有机制，不调用私有 reindex。

未验证：cold cache/Workspace 在其他 Client 的可见时机、外部 UI compiled strict RPC、empty stream 的 renderer/adapter 行为、逐项 Codex attribution。见 MVP spike，不能因类型存在就宣称端到端可用。

## 实际阅读的关键文件

以下为实际阅读的相关实现/定义（部分为定位后的片段），均位于上述只读源码根目录：

- AGENTS.md、package.json、docs/user/develop/basic/publish.md。
- packages/core/session/src/index.ts、types.ts、surface.ts、invariant.ts、known-event-types.ts、tool-history.ts；该包 package.json。
- packages/session/session-persistence/src/index.ts、handle.ts、storage-contract.ts；该包 package.json。
- packages/llm/llm/src/message.ts、types.ts、assistant-stream.ts、brand.ts。
- packages/api/session-controller/src/index.ts、types.ts、agent.ts、list.ts、client/contract/sessions.ts、client/sessions/service.ts。
- packages/workspace/workspace/src/index.ts、types.ts、entity.ts、paths.ts；该包 package.json 的版本/导出定位。
- packages/session-query/session-query/src/index.ts、corpus.ts、observation.ts；packages/session-query/session-query-sqlite/src/index.ts。
- packages/session/session-projection/src/index.ts；session-projection-cache/src/index.ts；session-title/src/index.ts、types.ts。
- packages/storage/storage-domain/src/index.ts；packages/interaction/commands/src/index.ts；packages/boot/cmdline/src/index.ts。
- packages/boot/app-boot/src/profile.ts、profile-resolution/resolver.ts、plugin-compatibility.ts、profile-compatibility.ts、compatibility-preflight.ts。
- packages/client/modules/src/index.ts、src/client/index.ts、src/client/manifest.ts。
- packages/client/ui-sidebar/src/client/index.ts、contract/slots.ts；packages/client/ui-layout/src/client/index.ts；packages/client/ui-slots/src/index.ts。
- packages/client/ui-plugin-manager/src/index.ts、src/client/index.ts、package.json、tsdown.config.ts。
- packages/typert/protocol/src/index.ts；packages/typert/generator/src/index.ts、package.json；packages/api/gateway/src/index.ts、src/client/index.ts。
- apps/desktop/src/project-manager.ts、runtime-tree.ts；vendor/cordis/package.json。
- apps/web/tests/fixtures/plugins/fixture-bundle/package.json、cordis.patch.yml；fixture-live-client/package.json、cordis.patch.yml。
- packages/bundle/base/cordis.patch.yml、packages/bundle/web-app/cordis.patch.yml 的 Session/Workspace/Client 装配行。

## P2 已验证补充（2026-10-08）

公开 protocol 与逐字段 DTO 映射详见 [P2_PROTOCOL](P2_PROTOCOL.md)，实际命令、合成测试及真实汇总见 [P2_VALIDATION](RELEASE_CHECKLIST.md)。

- 当前 executable 为 codex-cli 0.162.0-alpha.2，不能称稳定发行版；仅使用 experimentalApi=false 的 initialize/initialized/thread/list/thread/read。
- 公开 schema 证实 Thread.createdAt/updatedAt 与 Turn.startedAt/completedAt 为 Unix 秒，durationMs 为毫秒。DTO 前者乘 1000；不提供逐 item 原时间证据。
- Thread.model 明确为 loaded 时当前配置、cold 时最近持久化配置，**不是 per-turn execution telemetry**。P0 的逐项模型归因缺口已证实；不能为原生 assistant/source.kind:model 补 Thread 最新 model。
- list 的空 turns 是未 hydration，counts:null。真实本机查询 30 条非归档/0 条归档，均 source:vscode，4 条有 Codex Desktop originator；不是全部 Desktop/云端历史覆盖证明。
- 实际 30 条均 historyMode:paginated；两条样本 stable read includeTurns:true 返回全部 turn.itemsView:full。附 paginated-full-read-deprecated 警告；响应 partial/ephemeral 返回 unsupported，RPC 拒绝不绕过。
- Wire turn/item 数组顺序保留，连续两次抽样 ID 顺序一致；没有跨请求事务、没有全部正文不可变证明。cold completed/notLoaded 不能证明其他 Desktop executor 已停止。
- Tool 输出可以缺失，且 result 存在不等于 status 成功；command/mcp/fileChange 原状态与 null 保留，不生成可执行 DSH tool 回放。
- Thread.path 标记 UNSTABLE，adapter 完全排除。完整 schema 使用公开生成命令输出到项目 ignored artifacts，不读私有持久化。
- 根 Host 保持 P1，P2 reader 是独立 package subpath；未添加 controller/Workspace/query mutator，也未写 SessionEvent。

仍待 P3 验证：宿主原生 recall source.kind、assistant stream=[]（若仍有 faithful 路径）、完整持久化/readback/invariant/controller cold open/续聊与插件卸载。P2 不消除 DSH 原生 schema 或续聊风险。

## P3 原生 Session 已验证补充（2026-10-08）

真实 published rc.2 Loader 装配和合成请求快照见 [P3_VALIDATION](RELEASE_CHECKLIST.md)。

- public sessionPersistence.create → handle.append/flush/close → query.readSession/readSurface → controller.list/page/projections/resolveAgent/prompt 可完成合成 native continuation。bridge 卸载且两个新进程不装 bridge 时仍续接同 ID，turn 1→2→3，导入前缀不变。
- Controller list summary 字段为 sessionId；page 参数为 address/throughSeq/maxMessages，结果 records/hasMore；Host prompt 必须提供 AbortSignal。
- **首个 surface node 必须有 system/message 空占位**，在 turn 1/step 1 内闭合。content:[] 不导入 Codex system prompt，模型忽略空 node；下一次请求用宿主当前 prompt 更新头。缺头的日志可首次读回，但续聊后新进程拒读，负例已执行。
- P0“纯 recall 不必制造 step”需收窄：首个 turn 的结构性 system head 需要合法 step；转换 step 不意味着导入阶段执行模型。不能生成 request/header/usage/假 stream。
- materializeAppendBatch 仅 lossless JSON，assertContiguous 检查 seq；append 不自动做完整 vocab/关系校验。public validateStoredEvents(header,ownedClone) 显式拒绝未知 required；后端 fresh read 也拒绝。自有 receipt 必须 ignorable:true。
- Session/source.kind 的 codex-history 及未知 producer 在存储、surface、mock adapter 请求中可保留正文；原生 assistant stream:[] 在合成可靠 provider/model 下可冷读/继续，实际 Codex 的逐项身份缺口仍不能绕过。
- Title wire projection **values.title:string|null**；source.kind:user 固定 title，续聊不会自动改。cold list 不带 projection cache 时可以发现行，但不提供缓存 title；public projections 可 hydration，cache/UI 刷新还须验证。
- 已启用公开 dsh-session/invariant，turn=0 的 seed 被拒绝。public detached 校验/invariant 不能代替 released 存储关系与重启验证。
- Chat 的 public module/assembler/Context renderer 单元测试完成；unknown producer 显示 inject 标签，form:recall 不自动成为 session-reference 专用 recall UI。完整视觉/第三方 Client 安装未验证，没有私有导入或宿主 patch。

只读新增关键源码：packages/core/agent-loop/src/runtime-context.ts、agent.ts；packages/session/session-format-v3-to-v4/src/relationships.ts；packages/api/session-controller/src/commands.ts、list.ts；packages/client/modules/src/client/index.ts、manifest.ts；packages/client/ui-chat/src/client/apply.ts、conversation-nodes/message.ts、event-projection.ts、chat/ContextBody.tsx、ContextInjectionRow.tsx；packages/client/ui-conversation/src/client/conversation/assembler.ts。私有实现仅供解释，执行均走包导出/public service。

后续待验证：真实 provider HTTP/模型行为、Workspace mapper/attach、projection cache 预热、完整 Client UI/restart/install、生产 converter/importer/dry-run/receipt 幂等。

## P4 已实现字段映射（0.0.3）

实现与真实验证见 [P4_CONVERTER](P4_CONVERTER.md)、[P4_VALIDATION](RELEASE_CHECKLIST.md)。运行时只用 exact peer 的 public IDs/格式/纯校验/标题规范，Root Host 仍不启用导入。

| 输入 | 实际输出 | 限制 |
| --- | --- | --- |
| public thread.id | codex- + SHA-256('dsh-codex-bridge/v1\0'+原 id) | 与 title/cwd/时钟无关；target conflict/dedup 尚在 P6 |
| createdAtMs、调用方 selectedCwd | format=4 header.createdAt/cwd/isSeeded:false | 只 lexically qualified；不证明目录存在/Workspace 已关联 |
| user text blocks | native user/message，source.kind:user，surfaceOp:append | 原序保留；非文本需要显式 omission loss |
| assistant text/phase | codex-history recall user/message，正文标角色/JSON source/phase | current DTO 不提供逐项身份，strict 待审核；不套 Thread model |
| reasoning.summary | 标注 public reasoning summary 的 recall | raw/extra body 不参与 preview/event/hash |
| toolInformation.fields | P2 projector 重过滤 + key-sorted JSON recall | 无 native tool/call/result、命令/patch/URI/图片操作，缺结果另列 loss |
| contextCompaction / unsupported | 需独立接受的 marker / 仅 id/type receipt | 不恢复原压缩输入，不透传未知对象 |
| closed turn status/time | 1..N 边界、completed/interrupted/error、synthetic item anchor | 第一 step 内 empty system head；后续 recall 不造 model step；无 Date.now/duration 推算 |
| title / preview fallback | public normalizeSessionTitle → optional pinned session/title | pin 需显式 titleMode；原 title 在 receipt audit |
| public source metadata/turn/item | ignorable receipt，包含原 cwd/title、状态/版本/Thread-model audit、时间/映射/损失/路径格式 | Thread-only model 永不作为 native assistant source |
| 全部投影 | sourceFingerprint；header/events prefixDigest；含 receipt 的 planDigest | 一致性而非认证；blocked 时 plan=null |

convertSnapshot、sessionIdFor、validateConversionPlan 在插件自己的 public /converter 入口。SDK public validateStoredEvents 在 runtime 对独立 clone 执行；Session.create 只在测试使用，因为 constructor 会产生 end-seed 和时钟值，不从其 private/deprecated event reader 提取计划。

仍待 mapper/importer 的目录存在/路径竞争、source approval/stalePlan、唯一 writer/去重/恢复/cache/UI；当前 ready 只是转换可用，不意味着实际导入完成。

## P5 已实现 Workspace mapper（0.0.4）

公开 /workspace 子入口和 [P5_VALIDATION](RELEASE_CHECKLIST.md)、[P5_WORKSPACE_MAPPER](P5_WORKSPACE_MAPPER.md) 记录 actual runtime evidence。

plan 用 Node metadata APIs 与 public registry.list 给既有目录 create/reuse 建议，缺 cwd/无权限/文件/URI/异平台仅 needs-remap；constructor lazy。resolve/attach 必传 dryRun，dry-run 无 mutator。实际 resolve 使用 registry.create 只处理已有目录，returned Workspace.path/id 是 header authority；不调用 initializeDefault 或 setTitle。

public persistence.stat 校验已存 Session.header.cwd 与 Workspace.path 和实际 DirectoryIdentity；duplicate attach 也重检。未知/no cwd/mismatch 拒绝，无 Session writer/open/query reindex。scope only Workspace membership；Session log 不变，重启 membership 保留已在 published Host 证明。

Node realpath + dev/ino/birthtimeNs 字符串用于 plan/apply 前后变化检查。Windows drive/case/junction/中文空格实测，UNC/跨 OS 仅分类；EACCES/EPERM/EIO 模拟且未改 ACL。私有路径/entity只读证据，无 deep import；不 lower-case 全路径或改 Header/私有表。

P6 的审批/dedup/source freshness、P7 importer、网络 UNC/真实 ACL/全平台与完整安装仍未证明。

## P6 已验证的公开只读 seams

| 服务/接口 | rc.2 reference 文件 | 用途和稳定性 |
| --- | --- | --- |
| SessionPersistence.identity/stat/open(id,'read') | packages/session/session-persistence/src/index.ts | 同 provider 同 ID 变化检查；read 不持有 writer。公开、pre-stable，仅锁定 rc.2 |
| SessionHandle.header/read(offset,length)/close | packages/session/session-persistence/src/handle.ts | 分片读取目标、完整摘要/回执校验和 uncancellable teardown；公开 seam |
| assertContiguous/validateStoredEvents | packages/session/session-persistence/src/storage-contract.ts | 目标 seq 与当前格式验证；公开纯工具，unknown required 拒绝 |
| sessions.get(id) | packages/core/session/src/index.ts | 不 hydration 的 live collision 检查；公开 store API |
| SessionHeader.delegationDepth | packages/core/session/src/types.ts | 注释规定 absent=zero；已验证 public readback materializes 0 |
| JSONL 逻辑默认行为（仅阅读） | packages/session/session-persistence-jsonl/src/format.ts | header.delegationDepth ?? 0；只为解释 public readback，插件绝不 import private file |
| WorkspaceMapper.plan → WorkspaceRegistry.list | packages/workspace/workspace/src/index.ts | 复用 P5，只读 path/registry 建议，不 create/attach |
| CodexHistoryReader.read | 插件 src/codex/reader.ts；稳定 thread/read 协议见 P2_PROTOCOL.md | P6 可组合 adapter；测试 mock，只处理 P2 投影后的公开 DTO |

src/planner/{planner,target,types,errors,index}.ts 形成独立 package face。正常 Host 启动没有连接/扫描，未增加 runtime dependencies、DSH 版本兼容分支或 API controller 注册。

Codex→DSH 的消息/事件映射保持 P4，P6 不增加历史角色伪造。新增统一层字段：
thread.id → request.threadId / deterministic sessionId；
公开 Thread/Turn/Item 投影 → sourceFingerprint；
hydrated turns/items/messages → conversion.statistics（不信任 list counts）；
thread.cwd + explicit remap → workspace.request/canonicalCwd/identity；
P4 header/events → conversion.plan；
public stat + live get + read header/events → target；
receipt.sourceThreadId/sourceFingerprint/prefixDigest → imported/conflict 判断；
实际 DSH 尾部 → continuationEvents + target.contentDigest；
整体计划 → planDigest，仅一致性不是授权。

验证：18 项 P6 测试，真实 published rc.2 Host 的严格 dry-run及冻结计划复核通过。P6 当时未实现 P7 exclusive writer/原生导入流程（当前进展见后文）、P8恢复、生产命令或 Client UI；完整缓存预热/完整 Desktop 仍待后续。checkFresh 不是 reservation，序列化或重启必须重新规划。见 P6_IMPORT_PLANNER.md / P6_VALIDATION.md。

## P7 已实现 public writer / 读回 / 后置关联

| 服务 / 方法 | rc.2 reference 文件 | 用途、证据和边界 |
| --- | --- | --- |
| persistence.create / handle.append / flush / close | packages/session/session-persistence/src/{index,handle}.ts | 创建唯一目标 writer、追加合法 P4 events、明确 durability barrier、uncancellable cleanup。公开 pre-stable，仅 rc.2 |
| SessionAlreadyExistsError / AlreadyOwnedError | packages/session/session-persistence/src/errors.ts | 同 ID/所有权竞争拒绝，不按 raw message 判断，不打开 writer接管 |
| persistence.stat/open('read')、validator | packages/session/session-persistence/src/{index,handle,storage-contract}.ts | exact prefix/receipt/seq/header/full public readback；完成才能后置 attach |
| JSONL create / lease / close（仅分析） | packages/session/session-persistence-jsonl/src/{index,storage}.ts | public行为：create跨进程lease延后到materialization；close失败仍释放in-process claim。无private imports |
| WorkspaceRegistry.create / Workspace.attachSession | packages/workspace/workspace/src/{index,entity}.ts | 经P5 mapper运行，registry canonical path与directory identity重验；失败workspacePending，不rollback |
| SessionProjectionCache.coldSnapshot | packages/session/session-projection-cache/src/index.ts | structural public optional seam；projection返回不ack异步写回，结果requested/pending；不需要SessionStore.prepare/Agent activation |
| domain/changed | packages/storage/storage-domain/src/events.ts | 只在真实测试观察 cache durable commit readiness，业务 importer 不开domain/ledger |
| sessionController native续聊 | packages/api/session-controller/src/index.ts | 仅test明确调用冷读/续聊，证明原生 Session；importer本身不resume/prompt |

P6 新增只读 ImportPlanner.assertPersistenceProvider(plan, identity)，进程内原冻结plan与writer provider绑定。P7 /importer output提供state/stage/sessionVerified/workspace/cache/effects，Workspace facade异常时具体mutator facts=null，不假称未写。

Codex→DSH 消息/事件映射保持P4。P7 仅执行已审核conversion.plan.header/events，原source times/title/cwd provenance/receipt保留。读回允许已验证导入前缀之后的DSH追加尾部，并将完整实际log提供给cache；不覆写，不移植hidden reasoning，不补模型身份。

37项P7测试覆盖真实published Host import/unload/restart/native turn4、cache publicdurable event、所有故障和stat/create竞争。新增cacheSDK仅dev；core peer/deps策略与Root Host/patch不变。没有跨进程竞争全矩阵、真实Codex导入、生产CLI/Client或P8恢复。

## P8 public recovery seams 已实现

| 方法 / 服务 | rc.2 reference 文件 | 原因、边界与稳定性 |
| --- | --- | --- |
| SessionPersistence.identity/stat/open read / SessionHandle.read/close | packages/session/session-persistence/src/{index,handle}.ts | ownership-free读取完整既有target，复核provider/revision/SDKschema；公开pre-stable，仅rc.2 |
| assertContiguous/validateStoredEvents | packages/session/session-persistence/src/storage-contract.ts | 当前事件词汇/seq验证；P4 validator再次验证receipt闭合前缀，无private fallback |
| WorkspaceRegistry.list / Workspace.sessionIds/path/id / attachSession | packages/workspace/workspace/src/{index,entity}.ts | P8观察公开membership并经P5恢复关联；过滤/隐藏私有坏记录无法由插件探测，不查私有表 |
| WorkspaceMapper.plan/resolve/attach | 插件src/workspace/mapper.ts；宿主文件如上 | 依据stored header.cwd，创建registration只处理已有目录，不mkdir或变header |
| sessions.get | packages/core/session/src/index.ts | publiclive存在则busy，含idle但仍live，避免主动恢复影响当前会话 |
| SessionProjectionCache.coldSnapshot | packages/session/session-projection-cache/src/index.ts | 可选cache请求用完整真实日志及cut0；异步写回无法据返回值ack |
| domain/changed | packages/storage/storage-domain/src/events.ts；domain.ts | 仅真实测试等待cache durable readiness；业务无domain open/table/ledger |

P8 /recovery 输入为当前P6 ImportPlan和明确workspace/cache actions；RecoveryPlan总结stored cwd/revision/contentDigest/prefixDigest/全部eventCount及native continuationEvents，并以planDigest绑定后置审批。没有新的Codex→DSH event映射：原来receipt/P4事件和之后DSH全部事件均保持，任何目标/源变化阻塞重试。源依赖仍是公开P2 reader，不访问Codex私有数据库。

16项专项涵盖真Host response-loss重启恢复/native续聊/tail、strict dry-run和typedreadcapability；无新dependencies/peer/runtime内联，当前总包version0.0.7。API为独立插件公开face，未接command/CLI/Client，不表示正式环境已部署。P8_RECOVERY.md明确offline/path-remap/TOCTOU/后台cache ack限制。

## P9 批量编排 API 已实现

P9 /batch 使用同一 public plugin P6 ImportPlanner.plan/checkFresh 和 P7 SessionImporter.apply，没有新增宿主服务或私有持久化调用。

| 能力 | 对应源码 | 用途/稳定性 |
| --- | --- | --- |
| public sessions / persistence / Workspace | reference packages/core/session/src/index.ts；packages/session/session-persistence/src/{index,handle}.ts；packages/workspace/workspace/src/{index,entity}.ts | 经P6/P7使用已验证rc.2 seams；同/批量没有第二个writer实现，pre-stable且exactrc.2 |
| ImportPlanner.plan/checkFresh | 插件src/planner/planner.ts | 来源/目标/目录/provider复核；same-process original plan provenance保留 |
| SessionImporter.apply | 插件src/importer/importer.ts | 唯一实际导入路径，leaf approval/close/readback/Workspace效果复用 |
| BatchImporter / validateBatchPlan | 插件src/batch/{batch,selection,types,errors,index}.ts | 显式输入去重、逐项plan、全量前置审批、串行apply与有限结果；自有public插件API |

Codex字段→DSH event映射不变，batch只组织已审核ImportPlans。新增BatchEntry source id/fingerprint/cwd→来源报告，sessionId/targetCwd→目标报告，P6 plan state→plannedState，P7 result→stage/effects/warnings；selection/count/duplicates/digests→批次摘要。

own Workspace registration的change只在已有batch确认ID/path及P6 checkFresh workspace-only drift、相同source/target/identity/P4payload时接受。不会以新Codex内容或新的persistenceprovider替换审核材料。公开显示original/effective digest，内存journal不是persistent ledger。

20项测试与真正published Loader Host验证通过：3selected nativeSession共1Workspace，未选不写、最大leaf并发1、重启无新ID/native tail完整、partial及cancel边界。Root/peer/deps未变，CLI/Client/真实历史迁移尚未交付。

## P10 专用应用CLI已实现

| 服务 / 方法 | reference路径 | 用途与稳定性 |
| --- | --- | --- |
| CmdlineArgs.get / parseCmdline | packages/boot/cmdline/src/index.ts | publicapp-owned argv/同步grammar/helperexit，pre-stable，exactrc.2peer |
| AppReady.onReady / AppExit | 同上；apps/cli/src/profile-boot.ts（实现阅读） | 成功启动后做操作，readerclose后请求SDK boundedexit；不process.exit，不自造app启动 |
| profileContext name/home/dir/bundles | packages/boot/app-boot/src/profile-context.ts | publiclauncher profile意图参与review hash，不读私有backend配置 |
| 实际dsh --profile / --patch / args透传 | apps/cli/src/{args,bin,profile-boot,process-shutdown}.ts（只分析） | officialcompiledbin实际测试；不import/deep调用这些privatehelper绕launcher |
| P2reader / P6planner / P7importer / P9batch | 插件既有publicfaces | 同一迁移路径、计数hydrate/预览/review/fresh/write，CLI不写JSONL/SQLite |
| normalbundle vs opt-in cli | 插件src/index.ts vs src/cli/index.ts | Rootpatch保持health；CLI专用行enabled:true才parse，不自动影响Desktop |

CLIcmdline inject仅app-owned face；help/usage/version同步处理，不启动source。allbusiness工作等SDKready，operation effect ownsAbort/readerfinallyclose，appExit由SDK做profileteardown。publicSDK把未激活可选row作为warning，所以fatalstartup测试用坏overlay，而不是自行改变宿主策略。

Codex→DSH mapping仍P4；CLI输出null未知listcounts，preview/plan返回hydrate统计与loss/warnings。reviewDigest绑定publicprofile身份、checkedCLI配置、BatchPlan摘要；跨调用只比较意图，新process重新签发P6/P9plan，opaque backendrevision不当跨provider锁。--execute+review+逐项losses不保证外部backend配置未被改变，操作者确认profile。

新增ordinarycommander15（非Core），dsh-cmdline exactpeer+dev；launcherSDK及426新开发packages只dev，不入tar。真CLI-createdSession可freshHostnativecontinue；没有slashcommand/ClientUI/正式部署/真实迁移。

## 真实历史验收补充（0.0.9，无API变更）

实际CodexCLI仍0.162.0-alpha.2、DSH rc.2，非experimental public scan36非归档/0归档，2smallcompleted fullhistory双读sourceFP一致。只接受assistant-role-recall与tool-information-recall，actualCLI nativewriter/readback/Workspace成功，不使用私有持久化。

nativefreshHost无Root、syntheticLlmAdapter证明公开历史进入模型输入、原prefix完整、3→4/4→5；再CLI重复alreadyImported zeroeffects、fresh全部eventdigest保留tail，Source FP不变，publicheader.cwd/registry.path/realpath一致。ordinary/corepeer/数据流不变，无新source/dependencies/archive。样本均cwd存在，missingcwd/archived/全sourceKinds不推广为real验证。详见REAL_HISTORY_ACCEPTANCE.md，正式部署仍未执行。

## 正式单条接口验证（0.0.9）

安装版公开plugin manager和专用profile CLI在批准的真实单条上通过：publicpersistence.stat/open(read)、create/append/flush/close/readback、WorkspaceRegistry.create/attachSession、freshImportPlan与dry-run、跨进程already-imported。正式Desktop不挂bridge，仍能原生打开、输入框可用、受控重启读取。证据见FORMAL_SINGLE_IMPORT_ACCEPTANCE.md。

cache=skip时cold listing可先显示泛用标题，native打开后由宿主hydration显示已导入标题；没有调用私有刷新或修改querySQLite。GUI可合法追加end-seed/permission/sandbox/approval事件，检验应比较既有前缀和重导后的完整tail。真实provider消息发送与同Workspace多条cold会话定位未在本次单条中验证。

P11新增独立companion0.0.1，主包0.0.9不变。公开bindTypertRemote、WorkspaceTypertGenerator、RemoteResult/$mount、ui-renderer SlotRegistry与sidebar/main slots在插件自身mini-workspace构建及隔离Web中已验证，见P11_CLIENT_BRIDGE.md/P11_VALIDATION.md。生成器用真实npm SDK类型分析project，不改SDK代码/描述符、不导入参考私有构建helper。UI当前只有只读status，P12需接同一planner/importer及操作审批；不能把UI接入原型说成历史页可导入。

实际Web只服务广告的revisioned组合资产，直接猜client.js可能404；ModuleLoader包装、React/Cordis外部化、caller显式namespace注入与卸载清理已测试。缺asset/错版本Desktop及视觉/键盘/viewport矩阵未实际覆盖，不能承诺任意坏插件不影响启动。全部真实/正式/Dev数据保持原样，P11只在项目隔离home安装。

P12 companion0.0.2已增加status/list/preview/review/execute五个生成Remote。精确字段、public seams、source→preview/review/outcome mapping及宿主路径见P12_API_BOUNDARIES.md；实现复用0.0.9公开faces，无新增Session event词汇。实际installed Web/Edge与SDK native重启验收见P12_VALIDATION.md。Desktop shell/坏asset启动不因Web通过而视为完成。

P13：公开pluginManager.setBundleEnabled(name,enabled)（reference packages/boot/plugin-manager/src/index.ts）在故障Web中实际Remote恢复；正常Desktop通过公共管理页禁启。安装版plugin CLI负责故障副本安装及原tar重装。public persistence.stat/WorkspaceRegistry.list在测试Desktop退出后的fresh SDK Host证明dry-run目标未创建。ClientManifest/Entries/ModuleSystem与single-instance实现只读用于边界判断，未private import或修改；完整证据P13_VALIDATION.md。
