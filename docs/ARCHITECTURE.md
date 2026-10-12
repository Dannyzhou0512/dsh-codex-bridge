# dsh-codex-bridge V1 架构

状态：P1/P2 已通过阶段审核，P5 Workspace mapper 待审核，仅支持 DSH 0.2.0-rc.2。接口证据见 [API_MAP](API_MAP.md)，测试阶段见 [MVP_PLAN](RELEASE_CHECKLIST.md)，限制见 [RISKS](LIMITATIONS.md)。当前 Host 壳与独立 reader 已实现，converter/mapper 已实现；importer/UI 尚未实现。

## 方案比较与推荐

推荐先实现方案 1 的可复用 Host service + 专属 dsh profile CLI，证明原生导入、重启与续聊后，再接方案 2 的可选 Client UI。两者共用 adapter/converter/importer，不能各自写入历史。

| 维度 | 方案 1：Host + CLI/command | 方案 2：Host + DSH Client UI |
| --- | --- | --- |
| 功能 | 列举/元数据/预览/单条/显式 ID 列表批量/dry-run/去重/Workspace | 相同核心功能，增加侧栏浏览/勾选/映射/进度 |
| 复杂度 | 中等，核心转换/持久化仍复杂；需 app-owned argv/profile 生命周期 | 较高，另有双 face 构建、RPC descriptors、client graph、slots、locale、连接恢复和列表刷新 |
| 启动风险 | Host 延迟连接，无 UI artifact | 缺 client bundle/graph 错误可能让 client-modules 装配失败，React ErrorBoundary 不足以处理 |
| dry-run | 专属 CLI 可避免 commands 框架日志 | UI 调只读 plan RPC；所有 write RPC 也接受 dryRun |
| 发布 | 单个第三方 Host bundle，宿主 peers | 推荐独立可选 companion bundle，共享宿主 React/Cordis/UI |
| 推荐次序 | 先交付并验证 | 同一 V1 的后续可选阶段，不作为核心导入前提 |

slash command 可作为便利入口，但 commands 框架本身记录 command/run/result，不能作为整个 Session 零写入的 dry-run 证明。CLI 经 dsh launcher 启动专属 profile，不通过自带 Harness runtime 或 package bin 启动核心。具体语法需 argv 共存 spike 后确定，本阶段不假称已有可执行命令。

## Host 层

拟提供 codexHistory service：list、preview、plan、importOne、importMany。写操作均要求 dryRun 参数；CLI 默认为预演，实际写入须显式 apply。Client 只调用该 service，不访问 App Server、filesystem 或 persistence。

启动只解析轻量配置、声明能力和安装可释放服务；不自动扫描、导入或启动 Codex。外部连接与可选 ledger domain 延迟到用户操作。缺能力返回 capabilityUnavailable，不补装自己的 storage/runtime，不把缺服务误当空历史。

需求能力：sessionPersistence/sessionQuery/workspaceRegistry；sessions 用于 live 冲突与 public detached 校验词汇；sessionProjectionCache/sessionTitle/commands/gateway/typert 按功能可选。Web/Desktop 有 Workspace/controller，但 base profile 不一定全部提供；CLI profile 要公开装配所需能力，不改 core 配置行。

注册和子进程清理绑定 ctx.effect/ctx.on 的 fiber 生命周期。外部异常返回结构化结果，不能让网络故障拖住宿主启动。顶层 import、错误 manifest、client graph 和缺 artifact 无法靠 service catch 全覆盖，必须经 isolated release smoke 验证，不能宣称任意坏插件都不会影响启动。

## Codex App Server adapter

V1 首选可配置的公开 codex executable 的 stdio，lazy 连接；stdout 只读协议，stderr 独立。Windows 优先官方可执行 exe，不拼 shell 字符串；.cmd/PATH、中文空格、退出、分包、重连单独测试。

请求 allowlist 为 initialize、initialized、thread/list、thread/read；experimentalApi=false。不调用 resume/start/历史修改 RPC，不读取 SQLite、rollout 或 Desktop 私有状态。数据来源范围是用户选择的 server/home 配置，不推定独立 server 一定看见全部 Desktop/云端/远程会话。

list 分页保护重复 cursor；read 请求按 ID 匹配，配置超时、并发和响应大小上限。active/inProgress 默认暂缓，无法确认完整历史则 unavailable/unsupported，不自动切换实验接口。

adapter 输出 ParsedThreadSnapshot，按公开 schema allowlist 重建，绝不整包缓存 raw Thread。reasoning 只保留 summary；raw content/encrypted 字段不能进入业务 snapshot、preview、hash、日志、ledger 或 Session。

## converter

纯函数：ParsedThreadSnapshot + conversion policy + 映射结果 → header、typed events、统计、warnings、sourceFingerprint。没有 ctx/I/O/工具执行。

用户文本保留原生 user/message。assistant 仅在有可靠逐项 provider/model 证据时转 assistant/message；历史 stream 不可恢复时不编造 delta/usage。工具信息推荐 recall，不把 commandExecution/MCP item 冒充完整原始 assistant tool-call/schema。

预览提供明确的两种政策：

- strict：缺 attribution、附件或必要信息则 needs-review/unsupported，不写。
- recall：用户接受保真度损失后，将公开 assistant/tool/summary 保存为带来源的 core user/message 上下文，保留 originalRole/category/来源 ID。它是可持久化、可继续使用的 native Session，但不是完整角色恢复，也不能宣传无损。

建议提供 recall 降级选项，不能默默默认接受。有损范围在 plan 明示；至少有可用公开文本，否则不写空壳。只有 Markdown 文件输出不算成功。

events seq 从 0 连续，turn/step 从 1；有稳定 Message ID/source/content；消息 surfaceOp:'append'。检查 JSON safety、闭合、唯一 ID、大小、已知/ignorable 词汇；public Session.create detached replay 校验，自己持有原事件数组，不读已弃用 snapshotEvents。完整关系以 converter 检查与隔离 Host invariant 测试保证。

不导入隐藏思维链、Codex system prompt、permission/approval/sandbox 配置、provider replayState、OpenAI request/header、活跃 subagent 状态。续聊使用宿主当前 provider/model/prompt/tools/权限。session/end-seed 仅交宿主 constructor 管理；迁移不是 fork，header.isSeeded=false。

## workspace mapper

plan 时只读路径分类、Node stat/realpath 与 registry.list，不调用 create/attach/mkdir/initializeDefault。

结果包含 originalCwd、selectedCwd、canonicalCwd、mappedWorkspaceId、status。既有本机完全限定目录自动建议复用 Workspace；apply 调 workspaceRegistry.create，验证返回的 workspace.path 与预演一致，再以其作为 header.cwd。

missing、非目录、无权限、跨 OS、相对路径、远程 URI 不能自动关联。needs-remap 是候选状态；选定已存在本机目录后重做 plan，再生成 Session。**不能先写 cwd 缺失/失效的“可继续”Session**：Web cold routing 要 cwd，而 header 不可变，没有发现 public cwd update。

可选 remap ledger 使用插件独立 storageDomain，lazy 初始化；dry-run 只返回/内存记录。映射不移动项目，不创建目录，不复制或修改项目文件。已经完成导入的 Session 不允许重写 cwd，后续迁移已导入工作目录不属于 V1。

## importer 与 deduplication

Session ID：codex- + 完整 SHA-256('dsh-codex-bridge/v1\0'+threadId)。不含 cwd/title/updatedAt；路径映射或源内容更新不会生成新 ID。

权威去重在 persistence，ledger 只是报告。先 live get/stat，最终依赖 create 的 SessionAlreadyExistsError 解决跨进程竞争；stat→create 不是事务。已存在无来源证据的同 ID 返回 conflict，不采用或覆盖。

拟定义两个自有 log-only 信息事件 codex-bridge/import-start、codex-bridge/import-complete，均 ignorable:true，不影响 surface，不需要 message projection。记录过滤后的 source fingerprint、thread ID、converter/policy、original/selected cwd、统计、推导时间、expected count/prefix digest；complete 是计划最后一条。typed batch 构造 envelope，不假定 Session.append 的 opts 支持 ignorable（本版不支持）。

complete 的 count/digest 要经 readback 验证；receipt 不代替 flush 成功。完成后再次运行返回 alreadyImported，不同步 Codex 新增历史，不覆盖 DSH 用户续聊。核对 imported prefix，不将后续 DSH turn 纳入原计划 hash 比较。

默认有 start 无有效 complete、digest 不符、source 漂移或未知来源→incomplete/conflict，不自动用新 ID 重试。prefix 自动续写若实现须另测：exclusive open(write)、验证冻结计划每条 prefix 完全一致且未被用户续聊，仅追加余项，不 rewrite/delete。首个 MVP 可只诊断不自动 repair。

正式 apply 次序：

1. 取得过滤的完整 snapshot，完成转换/路径/版本/能力预校验。
2. apply 前重新读取 source fingerprint；不单凭 updatedAt 判断。变化返回 stalePlan。
3. create/reuse Workspace，核对 canonical path。新 Workspace 后续失败可保留报告，不能删除可能被其他操作使用的记录。
4. persistence.create(header)→append 预校验 events→flush→finally await close；同时报告原失败与 close 失败。
5. public read handle 核对完整 prefix/receipt；sessionQuery.readSession/readSurface 验证原生可读，不自动 resume Agent。
6. Workspace.attachSession(id) 并检查 membership；失败标 importedWorkspacePending，重试关联不重导。
7. 可选 cache 预热、Client 刷新；失败只给 warning，不回滚 durable Session。

公开 API 没有 create+append+flush+attach 整体事务或 abort/delete。create 后可能出现部分 Session，close 可能持久化 prefix；不能承诺任意时刻只有完全导入数据可见。V1 保证不重写已有资料、检测 incomplete、不制造重复，不能假称 rollback。强原子不可见需求需上游公开 seam；不能直接修改存储或 patch Harness。

## dry-run

与 apply 共用解析、转换、去重、路径检查，返回目标 ID、事件/消息数、降级、已有/新 Workspace、needs-remap、标题、warnings 与拟写阶段。

禁止 importer 调用 persistence.create/open(write)/append/flush、sessions.create、controller.create/resolveAgent/prompt/rename、workspace.create/attach、cache.coldSnapshot/write、storageDomain.open 或 ledger write。允许 persistence.stat/list/open(read)/read/close、registry.list、pure converter、detached 内存校验。

“零写入”指迁移本身。ordinary Host boot 可能初始化 registry/cache，commands 框架会记运行，App Server 公开 read 可能维护自身索引；不能声称整个系统字节不变。thread/list 的 useStateDbOnly 若实际 stable schema 支持可避免其扫描修复，但可能少记录，报告范围；不直接读 DB。

测试在已启动 disposable Host 上对 importer write spy 和 public Session/Workspace/domain 状态比对。若要求连 bootstrap 都无写入，需独立只读 plan 入口证明，不能把普通 profile boot 算作满足。

## 可选 Client UI

独立 companion bundle 提供 Host 面、dsh.client 与正确 ./client artifact，platform=web（Desktop 使用宿主 web client）。dsh.client.inject 用包名，Client inject 用服务名；共享宿主 React/Cordis/DSH，不引入 Node browser imports 或另一份 runtime。

sidebar.panellist 的自有 ID（拟 codex-history）对应 main 的同值 key。页面包含来源状态、分页、计数 hydration、公开预览、损失与路径映射、勾选、dry-run/apply、逐项结果、原生打开。工具输出/diff 仅文本展示，不执行历史 command/HTML/patch。

自有 Remote namespace 使用 TypertRemoteService/@Remote、published generator、Client $mount，不修改 sessionController。外部 strict descriptors、client registration artifact、Workspace 刷新与错误隔离是 UI 前置 spike；repo tsdown.client helper 不是已验证的外部 API。

导入后 Client sessions.refresh/refreshProjections；用户显式打开走原生路径，不自动新 turn，不自动触发模型费用。页面错误只影响该页；client graph 装配错误必须发布前发现。

## 数据流

~~~mermaid
flowchart TD
  Entry[CLI 或可选 Client UI] --> Host[Host codexHistory service]
  Host --> Adapter[稳定 App Server adapter]
  Adapter --> Snapshot[过滤的 Thread / Turn / Item snapshot]
  Snapshot --> Converter[纯 converter]
  Host --> Mapper[只读 workspace mapper]
  Mapper --> Plan[ImportPlan]
  Converter --> Plan
  Plan --> Dry[Dry-run 返回]
  Plan --> Apply[Apply 再验证]
  Apply --> Dedup[ID / receipt / live 冲突检查]
  Dedup --> Writer[宿主 persistence handle]
  Writer --> Durable[flush / close / public readback]
  Durable --> Attach[Workspace attachSession]
  Attach --> Refresh[投影和 Client refresh]
  Durable --> Native[用户显式原生打开 / DSH 续聊]
~~~

## 错误边界

| 范围 | 结果/处置 |
| --- | --- |
| Codex unavailable/timeout/protocol/too-large/incomplete | 当前操作失败，Host 继续；不自动安装、不换私有读取 |
| 转换不合法/缺 attribution/未知语义 | needs-review/unsupported；明确接受损失前不写 |
| 路径缺失/外来 OS/权限 | needs-remap/pathUnavailable；不 mkdir |
| append/flush/close/读回失败 | 保留可验证 prefix、关闭 writer、incomplete/unknown；不假称回滚 |
| 同 ID 竞争/writer-held | alreadyImported/conflict/busy；不强夺 writer |
| attach/cache/Client refresh | 区分 workspacePending 与 UI/cache warning；只重试后置阶段 |
| batch cancel/unload | 停止新条目，当前 handle await close，逐项状态明确 |
| loader/profile/client graph | 不私改 profile 自救；只能用宿主公开禁用/恢复机制。当前阶段不执行恢复/安装 |

## P2 实现边界（2026-10-08）

当前实现为独立 dsh-codex-bridge/codex 模块：CodexHistoryReader → 内部 ReadOnlyStdioClient → 公开 App Server stdio → allowlist parser → ThreadSnapshot。Host 根入口不 import reader，仍只提供 P1 健康描述；其 phase:'P1' 不代表 P2 模块缺失，而是没有启用导入入口。

constructor 无 spawn，list/read 延迟共用一次握手；stdio 用 byte-buffer framing，request ID 对应，pending/timer/abort 的所有权统一。超时/取消/协议失败使连接失效，close 等待自有 child 关闭；没有隐式 reconnect。错误是安全枚举，stderr ignore，不持久化 raw JSON。运行时只依赖 zod 与 Node builtins，DSH/Cordis 根 runtime external。

每个完整 read 仍有独立语义条件：unknown/non-text/inProgress/model attribution/弃用警告。paginated 实测 full 不等于未来兼容；Thread 最新 model 不足以做 faithful attribution，后续重点验证 recall 上下文。不同 probe 的当前工作区历史在 cold completed 状态下仍增加 items；workspace mapper/importer 尚未实现，未来 plan 不能靠该状态推断源冻结。

P2 全部读操作不创建 Session、Workspace、ledger、projection cache 或 profile；没有 Client UI/迁移 CLI。公共 schema、字段损失和版本范围见 P2_PROTOCOL.md，后续写入只在 P3 独立隔离 spike 中验证。

## P3 已验证约束与后续 converter（2026-10-08）

P3 没有添加 runtime 功能，仅构建隔离 published Host 与合成外部模型 adapter。sessionPersistence 与 query/controller/AgentLoop 共用宿主 Session class；卸载 bridge、跨两个进程重启后可继续同 ID，真实模型请求包含历史公开内容。

converter 的规范化前缀必须先建立 turn 1/step 1 内的空 system/message protected head，再放公开历史，闭合 step/turn。该占位不是 Codex system prompt，content=[] 不发送空模型消息；当前宿主 prompt 在后续原生请求维护。没有 head 的“初次可读”日志会在续聊后冷读失败，不能仅用初次 detached replay 宣称成功。

写入前需要 public validateStoredEvents 与明确关系/首节点校验，append 只负责 JSON/连续性。写入后 durable query readback/restart 仍必须保留。自有 audit receipt 标 ignorable，不能假定 append 自动拒绝未知 required event。

已确认 native recall/source kind 可持久化与继续，但 role 为 user，formatter 在正文显式标原角色/category/来源，不只写不可见 metadata。可信合成 attribution 下 stream=[] 合法；真实 Codex 仍缺逐项模型身份，不能因 spike 成功默认 faithful。

标题 pin 事件有效，wire title 是 string|null。没有 cache 的 cold list 可见但无 title hints，完整 importer/UI 要独立验证公开预热/刷新。Chat 单元 projection 把未知 producer 归 inject；core renderer 转发正文并默认收起，visual primitives 是测试替身，不等于完整 Desktop 安装验收。

## P4 实现（0.0.3）

public DTO → shared projector → canonical public fingerprint → deterministic IDs/preview/requiredLosses → explicit policy/mapping eligibility → header/events/ignorable receipt → public stored validation + own grammar → immutable ConversionResult。

Root Host 与独立 reader 不因 converter 引入启动动作。converter 的 /converter face 使用外部 exact core peers 的纯词汇/校验，不创建 Context、Session、writer 或 backend；只有合成 Host integration fixture 会通过 public handle 写测试数据。

strict 没有逐项 attribution 补洞；recall 逐项 requiredLosses 必须列在 acceptedLosses，正文有原角色与来源。无用/partial/active 源不给 plan，目标路径未选/不 qualified 给 needs-remap，未接受损失给 needs-review。第一 turn/step 里放 empty system head，后续 pure recall turn 只闭合边界；不制造 request/header/模型流/工具调用。

输出与所有 input/result/text/event/depth 限制是显式值，不读取时钟、random 或环境。public-fields projector 复用 P2，额外 raw reasoning/path/meta 不入 fingerprint/preview/events。源 fingerprint 与 prefix/whole-plan digests 分工，一致性校验不等于授权；P6 要绑定审批计划与来源/目标新鲜度。

P4 阶段尚无 mapper、importer、ledger、Client/RPC/CLI 注册。实际 generated plan 已经在卸载 bridge、两个新进程下 cold read 并生成 native turn 4；这不替代未来 path/幂等/故障/真实 provider/UI 验收。

## P5 已实现 Workspace mapper（0.0.4）

独立 lazy WorkspaceMapper 接收宿主 public registry/persistence capabilities 和明确 limits。plan 只读路径/realpath/list；显式 remap 只检测本机目标，不访问无关的原历史路径。source provenance 原 cwd 保留。

resolve/attach 显式 dryRun；resolve 返回 registry authority，future importer 据此生成 Header；attach 只关联已有 durable Session，不创建 Workspace/Session或启动Agent。header.stat 和目录 canonical/identity 每次校验，duplicate membership 也校验。

计划冻结/fingerprint/identity，操作前后重新观察。未开始时取消/路径漂移零 mutator；已开始的 public mutation 完成后记录 effects/警告，不承诺 rollback。没有 timers/隐式 retry/reconnect，OS metadata read不能强制 abort。mapper root默认不激活，无 profile/domain ownership。

P5 已验证真实 SDK 创建复用、大小写/junction、dry-run/no Session log change 与重启。P5 阶段尚无统一协调层或 importer；P6 已实现 path/converter/loss/source/target 统一规划，见下节。

## P6 已实现统一只读协调层

Host 根继续 lazy 健康壳，操作层仍是独立 package APIs，不把扫描挂在启动流程。P6 ImportPlanner 显式组合 Codex adapter.read、converter、WorkspaceMapper.plan 和 SessionPersistence 的 read seam；接收 sessions.get 的布尔 live 判断，避免 planner 拥有 Context 或 controller。

数据流：hydrate public snapshot → own public projector → validate conversion policy → path/registry plan → converter → bounded target read + receipt verification → immutable ImportPlan。dryRun:true 必传，不提供 mutator 方法，不创建 domain/ledger。数据只留本次调用及冻结值；WeakMap provider binding 为进程内 freshness，不持久化。

完整回执匹配相同来源则 already-imported，保留 DSH 原生尾部和原导入政策；旧来源已变化或目标不可验证则 conflict；匹配无回执前缀仅 incomplete-unverified。需要映射/损失确认/active/partial 不给 ready。ImportPlan.state 是未来写入入口的总闸，不能用 conversion.plan 非空绕过。

checkFresh 重新 hydrate/metadata/target；来源内容、目录 identity/Workspace、live collision、target revision/content 和 provider replacement 任一变化返回 stale-plan。原对象和当前 provider 绑定，跨实例/重启不复用审批。摘要不等于授权；P7 执行时仍需要明确选择和损失政策检查。

错误边界：只发有限 PlanningError code；await close 释放 read handle；取消/资源超限/坏回执不写、不回退私有文件。公有 JSONL 读回默认 delegationDepth=0 是已验证单字段等价，不泛化 schema 兼容。

P6 阶段 P7 importer 与 P8恢复尚未实现，P7 当前进展见下节。P6 观察不能排除 TOCTOU，最终公共 exclusive create 与 durable readback 才决定提交。可选 Client/CLI 都应复用同一 planner/importer，而非各自转换或直接写私有存储。

## P7 已实现单条执行层

SessionImporter 是独立 /importer face，Host入口继续lazy壳。操作方给reviewed frozen ImportPlan + explicit dryRun/cache + non-dry-run approval；executor校验plan provenance/provider、policy集合、freshness，不让内层conversion.plan绕过总状态。

写路径：Workspace resolve获得registry authority → replan（仅允许自身注册导致的create→reuse） → live/target/source/identity/payload重验 → public create writer → append/flush → await close → bounded exact public readback → attach → optional coldSnapshot。业务不调SessionStore.prepare/create、controller、LLM，不发伪造session/created或api-added通知。

result区分事实：write acknowledged、flush/close完成、exact prefix verified、Workspace关联、cache请求。后置attach不成功workspacePending；cache fail-soft；write/readback未验证incomplete，可能已写全部。未知facade effects保持null+warning，保留已发生结果，不私有rollback。

alreadyImported只skip旧来源，完整native suffix保留，不重做attach/cache；P8才设计后置恢复。唯一ID/create竞争拒绝，不open write接管。public SDK跨进程锁在首次materialization才获得，不能把create当作全局事务。

真实验证完整调用实际published Controller/AgentLoop + synthetic外部model：卸载Root bridge、重启后冷读nativeSession并接续turn4，model-visible public recall准确，membership和title重启保留。actualcache持久化通过publicdomain事件验证，业务仅reported requested。Root未装进正式环境，无CLI/UI入口。

## P8 已实现既有 Session 恢复层

独立 SessionRecovery 组合当前P6 plan、publicread persistence、P5mapper、publicmembership/live检查和可选coldSnapshot。没有writer、SessionStore activation、controller、model、storageDomain ownership。

diagnose：same-process/provider的当前source plan→fresh→完整既有log/唯一receipt/前缀验证→storedcwd目录/可见membership→冻结RecoveryPlan。源需可读且无变化，partial/unknown不采用；cache-only不依赖workspacecapabilities也不探测nativecwd。

retry：原RecoveryPlan对象+明确dryRun/approval→再diagnose/摘要相等→仅允许自身Workspace registration变动→source/full log/native tail/目录/membership再次guard→attach→cache前重新guard→请求完整actual日志cache。业务不保存完整log，不持久ledger、不rewrite/append/repair。

结果保持有限状态/原因/confirmed-or-null effects。已提交Workspace在失败/取消后保留，缓存异步ack不当权威，源/目标变化阻止旧snapshot回写。恢复过程中完整Session头与event log精确不变；liveSession保守busy。重启重新P6 plan+diagnose，WeakMap非持久审批。

真实Host响应返回前退出后的receipt识别、后置恢复、native续聊与再次restart验证成功，Root未加载仍可读。P9批量/P10CLI尚未实现，用户入口后续复用Importer和Recovery两条有边界的操作。

## P9 已实现批量协调层

独立BatchImporter只拥有P6planner/P7importer两个能力，不接触Context/sessionController/WorkspaceRegistry/private文件。plan接显式requests并先去重policy，逐项只读获取完整ImportPlan，safe failures保持每项可解释；完整批量图冻结并绑定原签发plan，不因公开JSONclone绕过provenance。

apply显式selection+batch/leaf approvals，先检查所有选择和损失集合，预留完整输出预算，再按首次选择顺序逐个await同一P7。没有第二个converter/writer，无自动repair/回滚。unselected不invoke，cancel结束当前writer清理后不启动下一条。

本次已确认Workspace create effect可解释后项create→reuse；source/target/provider/dir identity/payload保持，只有P6 workspace-only变化，effectiveleaf审批从已核对批次审批派生，并报告两个digest。没有猜测采用外部Workspace、更改source或跨backend写。内存own-effect journal限定单次apply，重启仍由receipt去重。

真实SDK多个Session与同Workspace、source模型可见续聊、重启重复skip、单项部分失败与cancel后续未启动都验证。仍只提供packageAPI，Root未变，P10才接宿主profile CLI，UI可选后置。

## P10 已实现profile应用消费层

/cli 是单独named functionplugin，只在专用profile显式挂enabled:true；Root defaultService/cordis.patch不变。应用读取SDKcmdlineArgs、parseCmdline接受invocation，ready.onReady运行一次；operation AbortController+Promise与effect disposer统一owner，finallyawaitreaderclose，再appExit。

CLIconfig已知字段与预算显式，trusted executable/args/home由profile管理；sourceKinds/archive/threads/mode/loss/remap由appflags明确选择，cmdline全转SDKArgs，不读取process.argv重建launcher。直接SDK appboot argv逃逸、packagebin、常驻Rootstartupscan均无。

read→P6/P9preview/plan→profile/config/batch reviewDigest→新processfresh再校验→同P9/P7 serialapply。跨process不接受旧JSON原plan，审批意图不充当身份认证或transaction。applydefaultdryRun；unsupported/needsreview原路径不被CLI强行补洞。

report有限codes/JSON，knownresultbudget写前预留，rawRPC错误或hidden不输出。取消/forcegrace与SDK实际shutdown归launcher，不能保证离线网络FS完成清理，partial后置由既有诊断处理。

真实compiled dsh bin消费staged/extracted外部bundle，helpers只prepareprofile/spawn，不绕SDKlauncher；CLI真正产生的原生Session在freshfullHost无bridge续聊证明。普通Desktop安装与真实history仍未执行；P11/P12可选UI后置。

## 已完成真实source的隔离闭环

0.0.9 actualtar→public AppServer realhistory→P6preview/review→P9/P7 actualCLI write→publicnativeSession/Workspace→freshHost syntheticnativecontinue→actualCLI rerun→fresh完整tail校验。2Session/2Workspace、原cwd保持、所有SDKstorage只在newownedprofile，Rootbridge在续聊Host缺席。

真实内容留ignorednative数据集、tracked只脱敏；没有新业务源/依赖或正式部署。真实模型未接，networkguard zero，证明语义输入/持久化和续接，不当作provider HTTP证明。下一步installation配置及与正式Desktop backend目录对齐审核，不因isolatedpass自动部署。

## 已验证的正式CLI部署

0.0.9安装在项目独立formal-cli-home的codex-import profile；minimal Host services连接正式sessions/storages，Desktop的原bundle/package/patch保持原样。批准样本经reader→converter→planner→dry-run→同一importer→publicWorkspace关联成为native Session。正式Host可在没有bridge的情况下打开、恢复其权限/seed状态并显示输入框；重导只识别receipt并保留native tail。详见FORMAL_SINGLE_IMPORT_ACCEPTANCE.md。

额外数据源/批量和模型发送不因本次单条授权而自动发生。可选Client历史页继续复用同一执行层；当前没有实现UI入口。项目内importer home包含部署配置/依赖，真实预览和回执保持ignored本地状态；不能把它们作为普通缓存自动清理或放入发布tar。

P11新增独立companion0.0.1，主包0.0.9不变。公开bindTypertRemote、WorkspaceTypertGenerator、RemoteResult/$mount、ui-renderer SlotRegistry与sidebar/main slots在插件自身mini-workspace构建及隔离Web中已验证，见P11_CLIENT_BRIDGE.md/P11_VALIDATION.md。生成器用真实npm SDK类型分析project，不改SDK代码/描述符、不导入参考私有构建helper。UI当前只有只读status，P12需接同一planner/importer及操作审批；不能把UI接入原型说成历史页可导入。

实际Web只服务广告的revisioned组合资产，直接猜client.js可能404；ModuleLoader包装、React/Cordis外部化、caller显式namespace注入与卸载清理已测试。缺asset/错版本Desktop及视觉/键盘/viewport矩阵未实际覆盖，不能承诺任意坏插件不影响启动。全部真实/正式/Dev数据保持原样，P11只在项目隔离home安装。

P12：独立companion Host配置可信reader、lazy固定本地runtime，Client只传archive/threadId/明确selection/remap/loss与Host-issued handle/digest/dryRun。Runtime复用P2/P6/P7/P9，global serial、20项/8审核/10分钟TTL，实际write一次性消费handle，先dry-run再确认。UI计划更改即失效；unload abort并等待writer/reader收尾；无新增writer/private存储。完整契约和bearer/跨进程边界见P12_API_BOUNDARIES.md。
