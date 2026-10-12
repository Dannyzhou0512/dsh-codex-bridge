# P9：显式选择的串行批量导入（0.0.8）

独立 dsh-codex-bridge/batch 导出 BatchImporter、validateBatchPlan、BatchError 和类型。仅编排同一个 P6 ImportPlanner 与 P7 SessionImporter，不提供新的 converter/writer、扫描所有历史、隐式恢复、CLI 或 Client UI。Root Host/patch 不变，启动不扫描/连接 Codex。

## 能力、选择与预算

BatchImporter({planner,importer}, limits) 只捕获能力并验证显式参数，没有 I/O。planner/importer 必须由调用方用同一宿主 public services 组合；P7 继续验证实际 plan/provider，而非相信 batch 输出摘要。

plan(requests, {dryRun:true,cache:'skip'|'refresh-if-available',signal?}) 的 requests 是显式 ImportRequest[]。每项包含 threadId、可选 remapCwd 和 P4 conversion policy（去掉 target）。没有默认选择全部历史。thread id 按原字符串精确匹配，不 trim/lowercase；确定性 ID 沿用 P4。

同 ID 相同语义政策只规划一次，first-occurrence order 保留，occurrences/inputCount/duplicateCount明示。acceptedLosses按集合比较；首次请求原政策保留。相同 ID 不同 remap/mode/title/limits/loss政策为 conflicting-selection，在任何 source read前拒绝；不擅自选一个版本。未知 request/policy扩展字段剔除，不进入计划。

limits必须明确：maxEntries（原始请求/选择/审批数量上限，包括重复）、maxSelectionBytes（投影后请求UTF-8）、maxPlanBytes（完整批量预览）、maxResultBytes（完整结果）、maxItemResultBytes（至少8192，给P7有限结果预留）。所有为正安全整数，maxResultBytes也至少8192。结果 metadata + 每个 selected项的完整leaf预算及有限envelope，在调用任何 importer前预留；预算不足拒绝，不先写后发现报告装不下。

## BatchPlan

逐项串行调用 P6 planner.plan；成功保存公开的冻结ImportPlan（包含元数据、预览、计数、损失、cwd/Workspace、warnings、target和digest）。单项source/能力故障是安全planning error，不阻止后续规划；source原始错误/cause不进入输出。

entry包括 index/threadId/sessionId/occurrences/state/error/plan，state为planned/failed/not-planned。BatchPlan状态planned/partial/cancelled/empty；planning取消后停止下一条source read，剩余not-planned，不在apply中暗中hydrate。

公开完整图复制并冻结，整体planDigest检查完整性。进程内WeakMap保存同一planner签发的原ImportPlans（避免JSON clone破坏P6 provenance），不是磁盘ledger。换实例/序列化/重启必须重新plan。

## apply 与完整前置审批

apply(batchPlan, {dryRun:boolean,selectedThreadIds:string[],approval?,signal?}) 必传明确选择。执行顺序固定为BatchPlan first-selection order，选择数组只决定集合，重复selected ID只处理一次。空选择是empty no-op，未选择项not-selected，绝不调用其importer。

非dry-run approval为：
- planDigest：精确整体BatchPlan摘要；
- items：每个被选择且planned的条目都有threadId/原leaf planDigest/acceptedLosses。
审批项必须与被选择且有leaf plan的集合完全一致；失败规划项没有leaf审批，报告planning-failed/not-started。所有选择/审批先全量检查，最后一条审批错也不会先写前面的条目。acceptedLosses必须与审核policy集合一致，batch不会补确认。

dry-run不需要写入审批，仍只对明确selected项调用P7 dry-run。单/批量使用同一个P7 executor，保留其freshness、provider、ready总闸、exclusive目标检查、flush/close/readback、Workspace/cache效果与错误合同。

V1只支持串行；不提供parallelism选项。每次await完整P7返回，包括finally close和后置步骤，才启动下一条。未知importer异常或超预算/错误身份的返回值，报告failed + invocationStarted/outcomeMayHaveCommitted，保留已有结果，不输出raw errors、不宣称零提交或rollback。正常leaf失败的具体已知effects以ImportResult为准。

取消停止后续项，当前P7仍await自己的writer清理。已完成/部分写入都保留，结果cancelled + not-started，绝非全批次回滚。

## 同目录的本批次已确认 Workspace 变化

预先规划多条同cwd、尚无Workspace的Session都会action=create。第一项由P7注册Workspace后，其他原计划会过期。batch只允许下面的范围内建立effective leaf plan：

1. 先前本批次P7返回明确workspaceCreateInvoked=true、合法workspaceId、已resolve的public authority；
2. 当前项原state=ready、原action=create，新action=reuse并匹配该owned ID/canonical cwd；
3. P6 checkFresh变化原因只能是workspace-or-directory-changed，不能provider/source/target/decision变化；
4. sourceFingerprint、directory identity、target observation和P4 conversion.planDigest完全相同。

仅这项原先已批准的自建registration变动可derive effective plan及对应P7 approval；loss政策不变。报告rebasedWorkspace、originalPlanDigest、effectivePlanDigest，转换内容和Session header/events不变。新Workspace显示标题不决定存储目的地，仍由同ID/path/identity authority决定，batch不修改它。

外部Workspace替换、缺目录/目录替换、provider更换、源变化、目标冲突等不获此例外，交给P7拒绝。若先前调用throw而没返回可确认ID，则不能据猜测采用新Workspace。ownedWorkspaces只在本次apply内存中存在，不是持久去重ledger，不重试partial。

## BatchResult

每项包括source threadId/fingerprint/cwd、目标sessionId/targetCwd、原plannedState、最终state、safe error、是否invoked、commit结果是否缺失、是否rebase及两个digest、完整可用的P7 result（含stage/warnings/Workspace/cache/cleanup）。详细title/预览/统计/损失仍在BatchPlan，避免重复复制正文。

summary统计selected/invoked/completed/alreadyImported/dryRun/blocked/failed/notStarted/notSelected。state为completed/partial/cancelled/empty。completed表示选定处理没有失败/阻塞/未启动，dryRun flag与各项dry-run明确说明没有导入；不能当全局事务commit。partial可同时包含已写成功和失败，不删除任何已有Session。

outcomeMayHaveCommitted只用于调用后无法得到有效leaf结果；false不表示正常completed没有写入，正常写入事实在P7 effects。资源/不可见结果异常不会伪造writer关闭事实。重启重跑需要新plan，确定性ID/有效receipt skip，原native tail不吞掉，workspacePending恢复由P8独立明确选择执行。

## 验证与限制

20项P9测试：显式选择/去重/冲突/全量前置审批、mixed cases、own registration/providergate、最大并发1、source/path漂移、leaf partial/unknown错误、planning/apply cancel、预算、实际artifactI/Oguard。

真实published rc.2 Loader Host：三个selected Session+一个unselected，共用一个Workspace；true dry-run与activation/domain-open guards；真实writer flush/close/readback/membership、卸载Root、两次新进程重启与native continuation，rerun只skip。真实append四事件后失败仍完成后两条；append后cancel等待当前close并不启动后来者。

所有来源/模型合成，临时根在插件 .artifacts。无正式/Dev profile update、无真实历史迁移或真实模型请求。Batch无CLI/UI/自动恢复，不冻结Codex全局历史或建立跨Session原子事务；P7/P8的TOCTOU、publicread内部内存/UNC硬取消限制继续适用。

下一步P10提供受宿主profile控制的CLI/command入口；本轮停在P9。验收和包/范围证据见 P9_VALIDATION.md。
