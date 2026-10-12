# P2：Codex App Server 只读协议

状态：P2 实现与项目侧验证已完成，等待审核；不进入 P3。DSH 目标仍严格为 0.2.0-rc.2。包版本 0.0.2，新模块通过 dsh-codex-bridge/codex 导出；Host 根入口仍是 P1 健康服务，不导入或自动连接 reader。

## 证据与兼容范围

实际公开 executable 的 --version 为 **codex-cli 0.162.0-alpha.2**。这是 alpha 二进制，不称为稳定发行版。本阶段仅使用非 experimental RPC 面，initialize 明确 experimentalApi=false。官网协议资料：[OpenAI App Server 文档](https://learn.chatgpt.com/docs/app-server)。

使用公开 app-server generate-json-schema / generate-ts，未加 --experimental，输出仅在项目 .artifacts/codex-schema/0.162.0-alpha.2。生成工具自身标记 experimental；生成的 ClientRequest 仍能包含 experimental 方法，**出现在生成类型中不证明稳定**。thread/turns/list、thread/items/list 被明确排除。

docs/protocol/CODEX_SCHEMA_FACTS.json 保存六份 schema SHA-256、时间单位与已审核方法；完整 JSON/TS 保留在 ignored artifacts，未复制到 runtime。校验器 Ajv 是 devDependency；运行时仅使用 zod 做公开字段投影。六个请求/响应合成样本均通过生成 schema，错误时间类型和未知 item union 两个负例均被拒绝。

这是单一实际版本的验证基线，不能推出全部 Codex 版本兼容。运行时不自动下载/更新 executable，也不以线程 cliVersion 冒充当前 server 版本；生产部署应提供可信绝对 executable、独立 argv、工作目录和公开 CODEX_HOME。argv 属于受信部署配置，不能来自历史正文/远程请求；本阶段生产探测固定 ['app-server','--stdio']。

## Wire 数据流

调用 connect/list/read 时才启动独立 stdio server；import/new/close 未连接 reader 均不启动进程。没有自动探测 Desktop 内部端口、复用私有连接或读取私有文件。

| 方法 | 实际参数/行为 | 原因 |
| --- | --- | --- |
| initialize | clientInfo{name,title,version}; capabilities{experimentalApi:false,requestAttestation:false,explicitGatewayOauth:true} | 明确非实验、无 attestation 请求；独立 gateway runtime 使用显式授权方式，避免自动浏览器授权 |
| initialized | notification，params:{}；收到 initialize response 后发送 | 完成握手再发历史请求 |
| thread/list | sourceKinds 显式非空；archived 显式 bool；useStateDbOnly:true；sortKey:'created_at'；sortDirection:'desc'；limit；后续 cursor | archive 状态分别扫描；避免默认交互筛选误判与 metadata rollout scan-and-repair |
| thread/read | threadId、includeTurns:true | 从存储读取历史，不 resume、subscribe 或开始模型 turn |
| server request response | error.code=-32601 | 拒绝审批/工具等 server 请求，不运行任何历史工具 |

list 的 sourceKinds 可用值：cli/vscode/exec/appServer/subAgent/subAgentReview/subAgentCompact/subAgentThreadSpawn/subAgentOther/unknown。真实探测选择 cli/vscode/exec/appServer/unknown；未扫描其他子代理来源，不承诺全来源。每次 list 独立扫描一个 archive 状态，合并两个状态由 consumer 显式完成。

cursor 是 opaque token，不自行解析；循环检测、maxPages/maxThreads 上限失败，不返回静默截断列表；同一次扫描重复 thread ID 保留首次记录。列表顺序随分页返回保留，尚无跨请求快照事务。read 对返回 ID 做身份校验，保留 server turn/item 数组顺序，重复 turn ID 或同 turn 重复 item ID 拒绝。

允许的历史调用只有 list/read。内部 transport 再做 runtime method gate；即使 JavaScript 绕过类型调用 turn/start，也在 spawn 前拒绝。公共子入口不导出原始 transport/parser，也不提供任意 RPC 或 raw response。

## 字段投影：Wire → P2 DTO → 后续 DSH

此阶段只产出 ThreadSnapshot，没有生成任何 SessionEvent。DSH 映射设计仍见 API_MAP.md；其 native 角色/recall 假设必须在 P3 验证。

| Wire 字段 | P2 字段/策略 | 后续转换含义 |
| --- | --- | --- |
| Thread.id/name/preview/cwd | id/title/preview/cwd；name 缺失为 null | 确定性 Session ID、title、工作目录建议；cwd 在 P2 不 stat/mkdir/attach |
| createdAt/updatedAt | createdAtMs/updatedAtMs = 秒×1000 | 转换前统一为毫秒；安全整数校验 |
| source/originator/cliVersion | sourceKind/originator/cliVersion | 来源诊断；object subAgent 合并为 subAgent，未知复合来源为 unknown，不保留完整 lineage |
| status.activeFlags/status.type | status/activeFlags | 是该 server 的状态；不是其他 Desktop executor 的全球活动证明 |
| ephemeral/historyMode | 原样保留 | ephemeral 为 unsupported；paginated read 成功仍附弃用警告 |
| modelProvider/model | modelProvider/latestModel；modelAttribution:'thread-latest-only' | 不作为逐条 assistant attribution；perTurnModelAttribution:false |
| Thread.path | 完全排除 | schema 标为 UNSTABLE，不访问其文件 |
| list Thread.turns | 不用于计数，counts:null | 未 hydration 不是 0 条消息 |
| Turn.id/status/itemsView/items | 原顺序、公开 item 投影 | itemsView 非 full 返回 history:'unsupported' |
| Turn.startedAt/completedAt/durationMs/error | 秒×1000/原毫秒/hasError bool | 无逐项时刻，不编造精确 item time；原 error 内容不作为 turn payload 输出 |
| userMessage.content[].text | userMessage.content[{type:'text',text}] | 后续原生 user/message |
| image/localImage/skill/mention | url/fileId/path 或 reference 描述；nonTextInputTypes | 不读取路径、不下载/导入附件；后续 strict/有损政策待验证 |
| agentMessage.text/phase | agentMessage.text/phase | 保留公开文字；不能凭 thread.latestModel 构造 faithful assistant |
| reasoning.summary | reasoning.summary | 仅公开摘要；后续独立标注上下文消息 |
| reasoning.content/encrypted_content | 不访问、不复制到 DTO | 禁止进入 preview、fingerprint、Session 或 ledger |
| commandExecution | command/cwd/status/aggregatedOutput/exitCode/durationMs | null 输出保持 null，不执行命令；tool.cwd 不替代 Thread.cwd |
| fileChange | status/changes[].path、kind.type/move_path、diff | 不 apply、不重建文件 |
| mcpToolCall | server/tool/status/arguments/result.content/structuredContent/error/durationMs | 只读工具信息；保留真实失败状态，不将 result 存在解释为成功 |
| dynamicToolCall | tool/namespace/arguments/status/contentItems/success/durationMs | 与 functionCallOutput 独立，不猜原始 call/result 关系 |
| functionCallOutput | name/namespace/output | 单独公开输出，不制造 callId |
| plan/webSearch/imageView/review/contextCompaction | 已知 text/query/action/path/review 或空信息 marker | 仅工具/信息投影；compaction 不重建模型内部上下文 |
| 未知 item.type/input.type | unsupported marker，仅 ID/type | unsupportedTypes/nonTextInputTypes 明示，未透传未知对象 |

工具嵌套 JSON 同时排除 reasoning_content/rawReasoning/encrypted_content/chain_of_thought（大小写与下划线/连字符标准化）及 _meta；嵌套 type:'reasoning' 只保留 summary。不会把 raw 对象放入缓存、错误或观察报告。不能识别任意字符串里的语义隐藏信息；边界按公开字段和协议类型确定。

这一 DTO 是公开内容的子集。text_elements、agent memoryCitation/delivery/questions、commandActions/processId、MCP app UI、git/project/section、subagent 详细语义等没有保留，不能称为无损备份。未知协作 item 暂为 unsupported；附件只描述，不迁移字节。toolItems 统计所有 toolInformation，包括 plan/review/compaction 信息，并非全部是可执行工具调用。

## 完整性与错误语义

history:'full' 只说明本次响应非 ephemeral 且所有返回 turn.itemsView 都为 full，**不等于语义无损、全局不可变或已经可导入**。未知类型、非文本 input、hasInProgressTurn、兼容警告与 provenance 是独立条件，下游不能只看 history 字段。

当前二进制对 paginated 历史仍成功支持 thread/read(includeTurns:true)，标记 compatibilityWarnings:['paginated-full-read-deprecated']。官方文档将该路径标记弃用/限制，未来可能直接拒绝；届时返回安全 rpc-failed 或 unsupported，不切实验分页、不读私有存储。legacy 完整读取未在真实环境抽样，因为实际 30 条均为 paginated。

独立 server 可读到正在本 Desktop 中变化的持久化历史，但 sampled turn 都可显示 completed、hasInProgressTurn:false。不同探测之间 items 数增加，**冷读状态不足以认定源不活跃**。未来 importer 必须按计划重读、验证公开 fingerprint/边界并拒绝漂移；P2 没有源冻结/全局 liveness API。

## 资源所有权与只读边界

transport 负责每个 request timer、abort listener、pending map、stdio、自己 spawn 的子进程。任何超时/取消/坏 frame/未知 response ID 会关闭该连接并拒绝其他 pending；RPC error 仅返回安全 code/rpcCode。reader 可重建新实例重试，没有隐式 reconnect。

显式限制 requestTimeoutMs/shutdownTimeoutMs/maxInFlight/maxFrameBytes/pageSize/maxPages/maxThreads/maxItems/maxJsonDepth，均无隐藏插件默认值。使用 shell:false、windowsHide:true；Windows exe 绝对路径，cwd/codexHome 绝对路径；不以 shell 拼接 title、cwd 或命令。stdout 采用 byte-buffer newline framing、UTF-8 fatal decode；支持多 frame/分包/乱序 ID。stderr ignore，通知不缓存，server request 拒绝。inspect 仅返回状态、PID、计数与 exit facts，不含 payload/ID。

环境只继承公开 OS/location/证书变量与显式 CODEX_HOME，可选公开 CODEX_SQLITE_HOME；不读取或继承 Desktop 内部变量、provider key、DSH 环境和 NODE_OPTIONS。程序不解析 credentials/auth 文件；历史权限由公开 server 使用既有配置决定。

consumer 必须 finally await reader.close()。close 先结束 stdin，宽限超时后只终止自己 child，并等待 close；重复 close 安全。本阶段 fake 与真实进程均已验证清理。Host 根入口不持有 reader，未添加配置/RPC/CLI importer 或 ctx lifecycle 集成。

“只读”指本插件不发历史修改 RPC、无 DSH migration 写入、不直接读取 Codex 私有持久化。App Server 本身启动/读取可能维护自己的正常缓存/元数据，未承诺 Codex Home 所有字节不变；useStateDbOnly:true 仅避免 list 的 scan-and-repair。未来 dry-run 应保证 DSH 迁移零写入，不能扩大为整个外部 server 零写入。
