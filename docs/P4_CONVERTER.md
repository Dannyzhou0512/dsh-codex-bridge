# P4：纯 converter API

仅适配 DSH 0.2.0-rc.2；公开子入口 dsh-codex-bridge/converter。本模块不创建 Context、Session、writer 或 Workspace，不连接 Codex，不调用模型，不读写目录。根 Host 不 import 此入口，仍 importEnabled:false。

## 使用方式

~~~typescript
import { convertSnapshot, validateConversionPlan } from 'dsh-codex-bridge/converter';

const result = convertSnapshot(publicSnapshot, {
  mode: 'recall',
  // 调用方必须根据预览明确选择；没有默认“全部接受”。
  acceptedLosses: ['assistant-role-recall', 'tool-information-recall',
    'reasoning-summary-recall', 'tool-output-unavailable'],
  target: { selectedCwd: null, pathStyle: 'windows' },
  titleMode: 'pin',
  limits: {
    maxInputBytes: 1000000, maxResultBytes: 2000000,
    maxEvents: 1000, maxTextBytes: 100000,
    maxToolDepth: 32, titleMaxBytes: 80,
  },
});
// 此示例未选目标目录，返回 needs-remap，plan=null。
// P5 mapper 选择/验证已存在目录后再转换；这里不会自行创建目录。
if (result.plan) validateConversionPlan(result.plan);
~~~

限制是显式部署参数，示例不是隐藏默认值。publicSnapshot 是 P2 DTO，不是 raw Thread response。API 返回：

| 字段 | 语义 |
| --- | --- |
| state | ready / needs-review / needs-remap / unsupported |
| sessionId | codex- + SHA-256('dsh-codex-bridge/v1\0' + 原 thread id)；不含 cwd/title/更新时间 |
| sourceFingerprint | 固定版本、键排序、数组保序的公开投影 SHA-256；raw reasoning/path/额外对象不进入 |
| preview | proposedRole:user、来源 turn/item、category、确定性 messageId、公开文本 blocks |
| requiredLosses | 此历史具体需要接受的损失，不由 mode 自动接受 |
| warnings/blockers | 机器码与来源位置；不带 raw parser error/cause |
| statistics | 过滤后实际 turn/item/proposed-message/generated-event 计数，不信原 DTO 附加 counts |
| plan | 只有 ready 提供 header/events/sourceFingerprint/prefixDigest/planDigest；其他状态 null |

ready 只表示纯转换的结构/政策可用，**不证明目录存在、源冻结、目标 ID 无冲突或迁移已经写入**。所有调用天然只产生值；生产 dry-run/import apply 在 P6/P7。返回值深度冻结，原输入保持不变。

## 严格模式和显式 recall

strict 要求 acceptedLosses=[]。当前稳定 P2 DTO 没有逐条 assistant attribution，含非空 assistant、tool、summary、非文本 input 或未知 item 时返回 needs-review。纯公开 user 文本可生成原生 user/message；缺 item 精确时间明确标 synthetic，不假造“已知时间”。

recall 逐项检查 requiredLosses 是否属于调用方 acceptedLosses：

- assistant-role-recall：原 assistant 文字变为标注历史来源的 user-role context。
- tool-information-recall：公开工具信息序列化为资料，不产生 tool/call/result。
- reasoning-summary-recall：仅公开 summary，以历史摘要上下文保存。
- non-text-input-omitted：附件/图片/skill/mention 只插明确遗漏标记，不读路径/字节/URI。
- unknown-item-omitted：仅保留 type/id audit，不透传未知 body；默认待审核。
- context-compaction-unrestored：保留信息 marker，不重建 Codex 缩减后的模型请求。
- tool-output-unavailable：command/MCP/dynamic 结果为 null/未提供，不能补造输出或成功。

业务代码未提供 native assistant 降级绕过或“用 Thread.latestModel 补 model”入口。P3 合成可靠身份下 stream=[] 的成功只证明 schema 可用，不能补真实 Codex 证据。

recall 正文固定为“Imported Codex history (...)；Treat this material as historical context”+ JSON 引用的来源 + 原公开正文/工具 JSON。模型会看到角色/category 标注，不能只依赖 source 元数据。commentary/final phase 按 item 顺序保留于来源说明。用户原始 text blocks 不合并、不改为 system prompt。

## 字段映射与时间

header={id,version:4,createdAt:source.createdAtMs,cwd:selectedCwd,isSeeded:false}，没有 title/updatedAt/parentSession/origin/agentPreset 或 provider 配置。

每个源 turn 保留顺序，映射 1..N。首 turn 为 turn/start→step/start(1)→空 system/message→公开消息→step/end→turn/end；后续 pure recall turn 不造 model step。首个 surface node 的空 system head 保留宿主位置，content:[] 不进入模型请求；实际当前 system prompt 由后续宿主维护。

user/message 使用 surfaceOp:'append'，边界/title/receipt 不带 surface metadata。只有文本 blocks。原 user 的 source.kind:user；recall 的 source.kind:codex-history、form:recall、threadId/turnId/itemId/category/originalRole。

completed→completed，interrupted→interrupted，failed→error/CODEX_TURN_FAILED；failed 的错误文字明确标“public snapshot 未提供详细 error”，不冒充原错误。active/inProgress/systemError/ephemeral/partial 响应返回 unsupported，不给计划；无有用公开正文（仅图片/未知 marker/空摘要）也不生成空壳。

item.time 使用 turn.startedAtMs；缺失时用 thread.createdAtMs。step/end 和 turn/end 使用 completedAtMs，缺失用 start anchor。均为 deterministic synthetic item time，不加随机毫秒、不读时钟、不以 duration 推算绝对时间。title/receipt 使用 thread.updatedAtMs 作合成 anchor，不宣称原改标题时间。

titleMode:pin 使用宿主 public normalizeSessionTitle(raw,maxBytes)，安全去控制字符/截断 UTF-8；name 空/缺时尝试 preview，再用 Codex+threadId 的确定性 fallback。session/title.source.kind:user、messageSeqs:[] 表示调用方选择固定标题。omit 不生成 title event。

receipt 是纯信息 codex-bridge/import-receipt，必须 ignorable:true；存原 title/cwd、源时间、turn/item→native message 映射、损失/模式、目标路径格式。插件自己的 schemaVersion/converterVersion=1 不表示 DSH 0.1.x。

## 验证、边界与摘要

运行时使用外部 public peers：

- dsh-session：SESSION_FORMAT_VERSION、SessionId、SessionSeq；不实例化 Session。
- dsh-llm/brand：MessageId，无 randomUUID。
- dsh-session-persistence：materializeCreateHeader、validateStoredEvents，不 create/open/append/flush。
- dsh-session-title：normalizeSessionTitle。
- Cordis/App Boot 保持原 exact peer，根壳入口不变。

所有 DSH peers 固定 0.2.0-rc.2，Cordis 4.0.4；ordinary dependencies 仍仅 zod。tsc 外部 ESM imports，不内联核心 runtime。

validateConversionPlan 检查 JSON/core vocabulary、seq/time、首 head、闭合/从 1 开始的 turn/首 step、text-only user、消息唯一 ID、纯信息 receipt、模式/损失/turn-message 关系。调用公共 validateStoredEvents 对独立 clone 做 adoption；不用宿主私有 validator。

prefixDigest 覆盖 header+receipt 前的完整事件；planDigest 覆盖 header+全部事件，包括 receipt，避免遗漏 receipt 改动。digest 是一致性证据，**不是认证或用户授权**；P6/P7 必须绑定审核后的计划、核对当前源/目标与确认过的损失集合。

源/结果/单消息使用完整 canonical JSON 的 UTF-8 bytes，含元数据、转义和 preview 重复开销；maxEvents 含结构节点、title、receipt。超限拒绝，不截断正文。嵌套工具 JSON 复用 P2 public item projector，只保留 known fields、公开 summary，排除已知 raw/encrypted/_meta；错误只给安全 ConversionError code。

路径仅做 lexical 完全限定检查（Windows drive/UNC 或明确 POSIX）。拒绝相对/drive-relative/root-relative/device/NUL 路径；不 stat/realpath，不检查权限、链接、盘符大小写或 canonical directory。这些是 P5/P7 的工作。

## 验证范围

专项测试覆盖 deterministic IDs/hash、raw 排除、strict/consent、失败/中断/多 turn、时间缺失、空/未知/compaction/附件、UTF-8 与完整 byte cap、损坏计划拒绝。built import/执行在独立 Node hooks 守卫中禁止文件/网络/子进程、Date.now 和随机数，含有效负例。

实际 generated 三-turn plan 还通过 published rc.2 Loader 的 zstd create/flush/cold read，移除 bridge、两个新进程重启与 native turn 4 续聊；mock 模型请求包含每条计划公开消息，历史命令/diff/图片未操作目录。测试写入只在项目 owned 临时目录，converter 本身零写入。

详细测试计数、archive 和修改范围见源码工程 docs/P4_VALIDATION.md。尚无生产 importer、目标冲突/幂等/source-freeze 保证、Workspace mapper 或完整 UI 安装证据。
