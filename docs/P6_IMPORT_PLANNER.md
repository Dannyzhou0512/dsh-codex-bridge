# P6：统一只读 ImportPlan（0.0.5）

本阶段只提供独立 dsh-codex-bridge/planner 子入口，不接入 Root Host 操作、不提供 importer、CLI 或 Client UI。只针对 DSH 0.2.0-rc.2；普通 dependencies 仍仅 zod，核心 SDK 精确 peer+dev，运行时 imports 外置。

## API 与能力

ImportPlanner(capabilities, limits) 不执行 I/O。capabilities 是显式的只读调用边界：

| 能力 | 调用 | 约束 |
| --- | --- | --- |
| source | read(threadId, signal?) | 可接 P2 CodexHistoryReader；P6 测试只接合成 reader |
| mapper | plan({originalCwd, remapCwd?}, signal?) | P5 public WorkspaceMapper.plan；不调用 resolve/attach |
| persistence | identity、stat、open(id, 'read') | 公开 SessionPersistence；从不 open write、create、append、flush |
| liveSession | id => sessions.get(id) !== undefined | 公开只读 live 查找，必须提供，避免忽略未持久化的同 ID Session |

必要能力缺失抛 PlanningError('capability-unavailable')，不伪造空目标。mapper 返回 capability-unavailable 则形成对应阻塞计划。Context、controller、query、cache、storage/domain、Workspace mutator 不进入 planner 能力合同。

limits 必须显式给出 maxTargetEvents、maxTargetBytes、readChunkEvents、maxPlanBytes，均为正安全整数。转换和目录限制仍由调用者分别传给 P4/P5，不引入暗含默认值。

plan(request, {dryRun:true, signal?})：request 为 threadId、可选 remapCwd、conversion（P4 options 去掉 target）。拒绝缺失/false dryRun；target 必须来自 mapper 的 canonicalCwd/pathStyle，不能由导入者随意覆盖。

checkFresh(plan, {dryRun:true, signal?})：重新 hydrate 来源、重新探测目录 identity/Workspace、重新读取目标与 live 状态。返回 fresh 或 stale-plan、原因和 currentPlan。只接受同一 planner 实例产生的原冻结 plan 对象；序列化/重启/换实例后必须重新规划。WeakMap 仅绑定进程内 provider identity，不是 ledger，不写磁盘。

validateImportPlan(plan)：纯一致性检查，校验整体摘要、转换摘要、映射摘要和 ready 前提。SHA-256 不是授权凭据，也不是外部数据可信性证明。P7 必须在实际执行点检查状态、用户选择及 acceptedLosses，不能把摘要当授权。

## 数据流和输出

公开 ThreadSnapshot → 重新投影公开字段并取得独立快照 → P4 校验转换政策 → P5 路径与注册表只读规划 → P4 最终转换 → public target inspection → ImportPlan。

输出包含 schemaVersion=1、dryRun=true、request、确定性 sessionId、sourceFingerprint、conversion（预览/逐项损失/统计/可选 header+events）、workspace、target、blockers、warnings、planDigest。完整图独立复制后深冻结，maxPlanBytes 覆盖整个 UTF-8 序列化结果。unknown request/policy 字段不进入输出。turn/item/message 数量从 hydration 内容计算，不把 list 未知计数当 0。

| state | 含义 |
| --- | --- |
| ready | 当前来源可转换、损失已接受、目录与 Workspace 能力有效、目标 absent 且 live=false |
| already-imported | 目标有唯一、已校验完整导入前缀回执，sourceFingerprint 与本次来源相同；保留原导入政策/路径及 DSH 后续事件 |
| needs-review | 降级未确认；保留预览，不提供 conversion.plan |
| needs-remap | 目录缺失/文件/URI/设备/异平台/不可访问，不能创建目录 |
| unsupported | active/inProgress、partial history、ephemeral 或其他 P4 不支持的输入 |
| capability-unavailable | 目录能力不可用；必要 reader/persistence/live 能力缺失则直接安全异常 |
| conflict | 同 ID 不能可信识别、回执/前缀不符、多回执、来源在旧导入后变化或 live 同 ID |
| incomplete | 已有头/事件与候选前缀相符但无完成回执；来源归属未证明，不能接管或自动补写 |

conversion.plan 存在只说明 P4 转换有效；P6 conflict/incomplete 时它可能仍存在。P7 必须依据整个 ImportPlan.state===ready，不能仅依据内层 conversion.plan。

already-imported 表示来源材料已导入，不承诺 Workspace 关联已完成。新的 remap/strict 政策不覆写旧导入；即使本次目录需要重新映射，也只报告现状，关联修复另行设计。

## 去重、读回和默认值

Session ID 继续沿用 P4 的 codex thread id 哈希，不受 cwd/title 改变影响。仅存在 ID 不等于已导入。

stat 前后必须来自同一 persistence identity、同 ID，revision 只在该边界内比较；open read 不获取 writer ownership。读取完整逻辑日志的有界分片，检查 public assertContiguous/validateStoredEvents，最后 await close（包括失败和取消）。metadata 计数/读取上限/完整结果字节上限任一超过即拒绝。

唯一 codex-bridge/import-receipt 必须 ignorable:true，schema/converterVersion=1、sourceThreadId 正确；调用 P4 validateConversionPlan 校验到回执为止的完整闭合前缀及 prefixDigest。随后 DSH 事件单独计数并纳入目标内容指纹，不删除、不要求与 Codex 转换输出相同。没有 receipt 的匹配部分仅为 incomplete-unverified，不作为 plugin-owned 证据。

实际 rc.2 JSONL public readback 会把缺省 delegationDepth 补为 0。core/session/src/types.ts 明确 absent=zero，session-persistence-jsonl/src/format.ts 实现 header.delegationDepth ?? 0。P6 优先验证实际完整 header；仅当摘要不符且该值恰为 0，允许去掉这个已知默认字段校验旧 P4 回执。其他字段和非零 depth 不归一化。未改宿主或 P4 格式。

target.contentDigest 覆盖实际 public header+全部日志（包括 DSH 续聊）；target.revision 只是该 provider 的 opaque 观察。sourceFingerprint 覆盖公开内容和元数据，内容变化即使 updatedAt 未变仍会过期；隐藏字段/list 报告计数不影响指纹。

## 错误边界和 strict dry-run

PlanningError 只给有限安全 code，无原始 stderr、cause、凭据、源正文或私有文件路径。失败不会报告 ready。请求取消在 await 前后检查；read handle.close 不可取消且必须完成，close 失败也拒绝成功计划。源码和 constructor 不调用 Date.now、随机 ID、LLM 或 resume。

P6 不创建 Session/Workspace/目录/domain/ledger、不 attach、不持久化 query/cache、不激活 controller。Host bootstrap 与合成测试 setup 的写入发生在测量前；plan 调用者若来自 slash command，command 框架自身日志不属于迁移写入，不能据此承诺整台 Host 零磁盘活动。未来 CLI/P2 source adapter 可能启动公开 App Server 子进程，但 planner 不拥有 transport；本轮未运行真实 App Server。

这是观察，不是锁或事务。fresh 后源、目录或目标仍可能变化；P7 必须重新检查并使用公开 exclusive create，P8 才处理部分导入恢复。readChunkEvents 限制消费者返回/保留的事件，backend open/read 可能内部完整解码；maxTargetBytes 不承诺约束 backend 内部峰值内存。过大的已导入目标也可能因界限而拒绝检查，不能猜测 skip。

原生 fs metadata API 无可取消的硬超时；离线 UNC 的真实行为尚未验证。正常 Host startup 不触发本模块。没有持久审批票据、跨进程 ledger、自动恢复或跨 Session 原子批次。

## 独立验证

npm run test:p6 覆盖纯合成来源、实际 metadata、public capability 故障/取消/限额、真实 rc.2 Loader Host 以及 built artifact I/O guard。实际 Host 使用项目内 disposable root、public handles 和 real Session/Workspace/storage/domain 服务；模型仅外部 synthetic adapter且 requests=0。包解压再运行 planner guard，不以源码开发入口替代 artifact。
