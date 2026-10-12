# P8：恢复诊断与后置重试（0.0.7）

独立 dsh-codex-bridge/recovery 导出 SessionRecovery、validateRecoveryPlan、RecoveryError 和类型。只适配 DSH 0.2.0-rc.2，不接管/补写 Session，不建立持久 ledger，不提供 CLI/Client。Root Host/patch 不变，启动不会自动恢复或连接 Codex。

## 能力与限制

SessionRecovery(capabilities, limits) 构造只保存引用和校验显式参数，零 I/O：

| 能力 | 使用的公开方法 |
| --- | --- |
| planner | P6 ImportPlanner.assertPersistenceProvider / checkFresh / plan |
| persistence | identity/stat/open(id,'read')，read handle.header/read/close |
| mapper（workspace retry 必需） | P5 plan/resolve/attach |
| registry（workspace retry 必需） | public WorkspaceRegistry.list 和 Workspace.sessionIds/path/id |
| liveSession | public sessions.get 的只读布尔判断，必需 |
| cache（可选） | public coldSnapshot(meta, SessionLogOffset(0), completeEvents) 的结构化 seam |

没有 persistence.create/open write/append/flush、SessionStore.create/prepare、controller、LLM、storageDomain seam。mapper.resolve 可经 public registry.create 注册一个已经存在的目录；不 mkdir。mapper.attach 只关联完整已验证的 Session，不 detach/move/delete。

limits 全部显式：maxReadEvents、maxReadBytes、readChunkEvents、maxWorkspaces、maxPlanBytes、maxResultBytes（结果结构保底至少 8192 bytes）。完整冻结 Diagnosis 及 Outcome 有 UTF-8 限制，读取含 header 和返回分片的消费者 byte/event limits；不承诺约束 backend 内部全量解码峰值或 UNC 的 OS 硬取消时间。

调用者先获得当前 P6 ImportPlan。P8 依赖 P6 source.read；需要公开 Codex 来源仍可读取且指纹未变。没有独立离线恢复入口；源失联/变化不能绕过新鲜度门槛。调用者拥有 reader 的 finally await close 生命周期。

## diagnose 与状态

diagnose(importPlan, {dryRun:true, workspace:'skip'|'retry', cache:'skip'|'refresh-if-available', signal?}) 只读。

校验同 planner/process/provider 的原 ImportPlan，checkFresh 后独立 bounded public read 检查全部当前逻辑日志、seq、SDK schema、唯一完整 receipt、P4 闭合前缀/摘要/source id/fingerprint、stat revision/provider identity。只允许已验证的 delegationDepth absent=0 默认等价。用实际 header+全部事件摘要与 P6 observation 对照，包括所有 DSH 后续 turn，不只比较最初导入长度。

| state | 含义 |
| --- | --- |
| recoverable | 来源/完整 target 已验证且冷态，存在明确 Workspace/cache 后置动作 |
| noop | 目标完整，所选动作已经满足或可选 cache 不存在；不写 |
| absent | 没有目标；恢复不会调用 importer 创建它 |
| incomplete | 缺完整回执/只有未验证匹配前缀；只诊断，不自动 prefix repair |
| conflict | 来源变更、未知目标/回执问题或公开可见 Workspace membership 冲突，不采用 |
| busy | Session 在 public live store 存在，保守暂缓恢复（包括 idle 但仍 live） |
| needs-remap | 存储头的 cwd 目前缺失/不可用；不创建目录、不改 immutable header |
| blocked / stale-plan | 非可恢复输入、能力/当前状态变化；安全错误也可抛有限 RecoveryError |

RecoveryPlan 包含 importPlanDigest/sourceFingerprint、actions、session summary（cwd/revision/contentDigest/prefixDigest/eventCount/continuationEvents）、workspace mapping、公开 membership、cacheAvailable、planDigest；不返回完整日志或模型正文。完整图复制并冻结，进程内 WeakMap 绑定原 P6 plan/provider；序列化、换实例或重启后重新 diagnose，不把 WeakMap 当持久 ledger。

完整回执是已有材料的证据，不是用户认证；planDigest 只是完整性。已导入采用原 receipt/header；本次 converter 因 strict 没有 plan 或提出新 remap 也不替换原生 header。workspace retry 始终根据存储头 cwd 规划；原历史 cwd 与当时 import remap 可不同。

仅通过 public registry.list/sessionIds 看可见 membership。若多处或错误路径可见关联则 conflict，不改私有记录或移动 Session。宿主隐藏/过滤的坏私有记录不属于插件诊断能力。

## retry 与提交语义

retry(recoveryPlan, {dryRun:boolean, approval?:{planDigest}, signal?}) 必传 dryRun。非 dry-run approval 必须精确绑定本次 RecoveryPlan，actions 已在 plan 摘要中；不能换动作后仍用旧审批。只有该实例发布的原冻结 plan 可执行。

1. 重新 diagnose 原 P6 plan；整体 RecoveryPlan digest 不同即 stale-plan，不默许新的目标/目录/membership/动作。
2. blocked/incomplete/conflict/busy/needs-remap 等不写；dry-run 或 noop 零后置 mutator。
3. 未关联时 resolve 原 cwd 对应 Workspace；可能创建 registration，但目录必须已经存在。
4. 允许自己 registration 导致的 create→reuse，重新读取 source/target/log/native tail，检查 directory identity、canonical path、registry ID 和公开 membership后 attach。
5. cache 前再次检查 current source/完整 Session 内容/revision/live、目录与 membership，使用最新且仍与批准 observation 一致的完整实际日志调用 coldSnapshot。
6. Session 头/事件始终不改，后置失败保留现状，后续重新 diagnose/显式 retry。

RecoveryResult：state/stage/reason/sessionVerified/workspaceId/cacheStatus/effects/warnings。state 为 dry-run/completed/noop/blocked/stale-plan/workspace-pending/cancelled/failed；completed 指本次可执行的后置步骤完成，不是新增 Session。

effects 分开记录 facade 调用与其报告的 create/attach facts；异常时 createInvoked/attachInvoked=null（未知），不是 false。自身 registration 或关联可能已提交时明确警告，不承诺 rollback。附加步骤失效/取消不删 Session/目录/锁/私有表。

coldSnapshot 返回后内部异步 fail-soft writeback，所以 cacheStatus=requested 不是 durable ack；同步/可等待 facade 异常为 pending，已修复关联仍保留。真实测试通过 public domain/changed(session_projcache/sessions) 事件证明测试 checkpoint 的实际持久化；业务没有开 domain 或访问私有 cache table。

SDK Workspace操作与 read close 不可强制取消，必须 await settlement。关联后取消保留 completed/commit warning，未请求 cache 则 pending 或 skipped；目标内容/源在关联后变化会 stale-plan、阻止 stale cache，关联可能已发生的事实不隐藏。

## 不自动修复历史

缺 receipt 的匹配 prefix 不能证明 plugin ownership；不打开 write handle、不补事件、不删除、不换 ID、不接管未知日志。P7 的 flush/close/readback 未确认可能实际已有完整 Session：当前 P6 plan 能通过完整 receipt 重新识别并允许后置恢复。真正 partial 继续 incomplete；SDK 自己的 interrupted 补边界不等于完成的 Codex receipt。

不存在的 native cwd 只 needs-remap，原生 header 不可通过当前已验证 public seam 改写。用户可选择 workspace skip 做 cache-only 操作；P8 不以新候选 remap 绕过 immutable cwd。目录 identity 只绑定当前 diagnose/retry 观察；P4 receipt 没有持久 filesystem inode，不能证明跨重启期间历史目录从未被替换。

public live store只覆盖当前宿主，不证明其他进程没有活跃writer。checkFresh/guard 是观察，不是跨进程事务/锁。native writer/live activation 在最终检查后仍可能发生；SDK负责 append-only/Workspace/cache合法性，插件不声称绝对消除 TOCTOU或跨域原子性。

## 验证和后续

16项 P8测试包含合成故障/限额/转移审批/目录替换、stored-cwd/strict policy、完整 native tail、不采用 partial、live 暂缓、unknown effects、取消和built I/O guard。

真实 published rc.2 app-boot/Loader Host：P7 writer flush/close/读回后、在 attach/响应前退出 → fresh进程读 receipt并修复Workspace/cache → native续聊 →另一次重启仍可补请求cache且原header+全部tail不变。Root bridge缺席，Recovery全程Session writer/activation/domain-open guards，public cache durability event就绪，不用sleep。所有数据合成、根目录在插件 .artifacts；没有真实模型或真实历史迁移/安装。

P8完成后停留审核；P9批量、P10 CLI、可选 Client UI和最终真实历史隔离验收仍待后续。详细运行/包/范围证据见 P8_VALIDATION.md。
