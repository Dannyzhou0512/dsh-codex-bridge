# P7：单条 Session importer（0.0.6）

dsh-codex-bridge/importer 提供独立 SessionImporter，负责执行 P6 已审核的单条计划。只针对 DSH 0.2.0-rc.2，不修改宿主或私有存储格式。Root Host/patch 仍是 lazy P1 健康壳，尚无生产 command/CLI/Client UI 或真实历史迁移入口。

## API 与调用者责任

SessionImporter(capabilities, limits) 只捕获能力和显式限制，不 I/O、不自动配置 Codex。能力：

| 能力 | 使用 |
| --- | --- |
| planner | P6 ImportPlanner.checkFresh / plan / assertPersistenceProvider |
| persistence | 宿主 public identity/stat/open read/create；writer append/flush/close |
| mapper | P5 WorkspaceMapper.resolve / attach，显式 dryRun:false |
| liveSession | public sessions.get 的只读布尔判断，写入前必需 |
| cache（可选） | public coldSnapshot(meta, inheritedEventCount, completeEvents) 的结构化 seam |

planner 与实际 writer 必须绑定同一个 persistence identity；传入其他 backend、序列化或换实例的 plan 不能写。P6 新增 assertPersistenceProvider 为纯只读一致性断言。mapper 应来自同一宿主 registry/persistence；resolve 返回的 Workspace ID/path 必须被 planner 重新列出确认，不能用候选 cwd 代替 registry authority。

调用者拥有 P2 reader 生命周期，必须 finally await reader.close()；importer 不关闭调用者 reader、不启动 transport。以后 Host/CLI/UI 应先展示 plan、明确选择与损失政策，再调用同一 executor。

apply(plan, options) 的 options 必須包含：
- dryRun:boolean，不能省略；
- cache:'skip' 或 'refresh-if-available'，没有隐式缓存政策；
- 非 dry-run 必须 approval:{planDigest,acceptedLosses}，摘要与原审核 plan 完全相同，acceptedLosses 集合与审核转换政策一致；
- 可选 signal。

approval 绑定本次选择和损失集合，不是认证机制。摘要仅一致性；外部消费方仍负责用户选择与权限。未接受必需损失/active/partial/缺路径不能通过 approval 绕过 ready 总闸。重复 no-op 的非 dry-run 调用也要求显式 approval。

limits：maxReadEvents、maxReadBytes、readChunkEvents、maxResultBytes。前三项为正安全整数；完整结果 envelope 的 maxResultBytes 至少 8192 bytes，这是有限状态/原因/效果/512-byte Workspace ID 的结构安全下限，不是推荐默认。计划已有 P4/P5/P6 上限；P7 写入前检查已知导入前缀能否容纳于读回限制，不能注定读回失败还先写入。后续并发尾部仍可能触发读回上限。

## 执行顺序

1. 校验 options、完整 plan、非 dry-run approval 和 persistence provider。
2. P6 checkFresh 重读来源/目录/Workspace/目标；过期即 stale-plan，不自动接受 currentPlan。
3. already-imported 只 skip，保留原政策/路径/DSH 尾部；非 ready 阻塞。dry-run 在只读复核/容量检查后结束，无 migration mutator。
4. 非 dry-run 调用 public mapper.resolve 创建或复用已有目录对应的 Workspace，绝不 mkdir。
5. 再次 planner.plan：允许本操作自身的 Workspace create→reuse 变化；来源指纹、转换 planDigest、目录 identity、registry ID/path 必须保持批准含义，目标仍 absent/live=false。检查 public liveSession。
6. public persistence.create 获取新 writer，检查 header/access/id；append 完整 validated events→flush→finally await close。从不 open write 接管现有目标。
7. public stat→open read→bounded read→assertContiguous/validateStoredEvents→完整批准前缀逐事件比较和唯一 receipt→stat revision/identity 检查→await read close。只允许已知 delegationDepth absent=0 header 等价，其他字段不忽略。
8. 读回通过才 sessionVerified=true；调用 public mapper.attach。
9. 关联成功可调用 public cache.coldSnapshot，随后返回有限冻结结果。

写入后若另一个 native writer 已追加尾部，读回允许验证后的额外 DSH 事件，缓存使用完整真实日志，不截断或覆写；读取期间 revision 改变则拒绝成功，不用过时内容缓存。

## 结果合同

ImportResult 包含 schemaVersion、dryRun、sessionId、原批准 planDigest、decision、state、stage、reason、sessionVerified、workspaceId/status、cacheStatus、effects、warnings，不复制历史或 SDK raw errors。

| state | 含义 |
| --- | --- |
| dry-run | 仅检查；decision 说明计划状态。已导入来源可 sessionVerified=true，但没有写入 |
| completed | importer 已 flush/close、公开完整读回、Workspace attach 成功；缓存不是成功权威 |
| already-imported | 同来源完整 receipt 已验证，未写/未修复 Workspace、未请求 cache |
| blocked / stale-plan | 计划不可执行或审核状态变化；此前自身 Workspace registration 可能留下，effects 明确 |
| conflict | 已有 ID/另一 writer/live collision，不接管、不换 ID、不关闭别人 handle |
| incomplete | 创建/写入/close/readback 失败，或创建后取消，完成未验证；可能部分或全部已写入 |
| workspace-pending | Session 完整读回已验证，关联失败/取消或关联效果未知，Session 不回滚 |
| cancelled / failed | 创建前取消/服务故障；Workspace 可能已被 public resolver 注册，不能假称零提交 |

effects 记录阶段调用及已知结果。workspaceResolveInvoked / workspaceAttachInvoked 是 facade 调用事实；workspaceCreateInvoked / attachInvoked 在 mapper 突然抛异常时为 null（未知），不能当 false。writerAcquired 仅表示 importer 收到了自己的 create handle；writerCloseSucceeded=false 是清理结果未确认，不保证锁仍在或已释放。有限 warning 标出 unknown/may-remain，绝不删除目录/私有记录/锁文件。

cacheStatus：skipped、unavailable、requested、pending 或 not-attempted。coldSnapshot 返回 ProjectionSnapshot 后异步 fail-soft 写回，requested 不是 durability acknowledgement；同步/可等待的 facade 失败标 pending，不降低已验证并关联的 Session。真实测试另通过 public domain/changed 事件观察 checkpoint 持久化，importer 不依赖内部 table/put。

## rc.2 实际行为和错误边界

JSONL create 的同进程 pending/已有目标检查能拒绝重复；跨进程 lock 在首次 materialization 前获得。因此不能把 create 返回当成已完成跨进程事务。P7 不接管已有 writer、只通过 SDK create/append/flush 发布；stat/create 和 writer-held 在真实 Host 已覆盖，同 profile 多进程完整竞争矩阵仍待后续，不保证跨源/Workspace 原子事务。

write close 是不可取消、幂等 promise。JSONL SDK 在 drain/release 失败时仍释放同进程 claim 后拒绝；importer await 一次并保守报告失败，不自行删除锁或重试 rejected close promise。任何 create/append/flush/close/readback 故障都不声称完成，也不私有 rollback。

部分日志在宿主 public open write/Session preparation 后可能获得 SDK 的 interrupted 边界。P7 importer 从不 open write 恢复。故障测试先 public read 确认原部分前缀，再用测试自己的 public writer-open 检查 ownership release；后者可能触发宿主恢复，不能归因于 importer 或当作已导入 receipt。

取消在 await 前后与 mutator 前检查；SDK 不可取消的 close/Workspace 操作仍 await settlement。已经验证并关联后取消保留 completed，并报告取消点/cache 未执行。读回未验证不能因为 flush 曾成功就标 completed。

## 模型和持久化影响

apply 本身不调用模型、SessionStore.create/prepare、controller.resolveAgent/prompt，也不执行历史 command/diff/image。后续用户原生续聊会携带 recall user-role 上下文、使用当前宿主 system prompt/配置，增加 token/KV-cache；不恢复隐藏思考、原 tools/replay state 或逐项模型归属。

Session/Workspace/cache 的持久化均由宿主 public 服务拥有；插件不读写 JSONL/SQLite/private storage。ordinary dependencies 仍只有 zod，核心 runtime 外部 exact rc.2 peers。新增 session-projection-cache@rc.2 只为真实测试的 dev dependency；插件使用 structural public capability，没有 runtime deep import 或内嵌 cache SDK。

## 验证与后续

37 项专项测试包含严格 dry-run/审批/跨 backend拒绝、strict user-only、每阶段故障、部分/全量不确定写入、完整读回、公共所有权释放、真实 Workspace/cache、插件卸载、两次重启与真实 AgentLoop synthetic model-visible continuation。

P8 的 workspacePending/cache 重试及恢复诊断、批量/CLI/Client UI 均未实现。重复已导入只 skip，不自动修复缺失关联。真实 Codex 导入/正式环境安装与真实模型调用未执行。验收证据见 P7_VALIDATION.md。
