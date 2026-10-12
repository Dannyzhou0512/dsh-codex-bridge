# P5：Workspace mapper API

目标仅 DSH 0.2.0-rc.2。公开子入口 dsh-codex-bridge/workspace；Root Host 仍只提供健康状态，不 import mapper，不在启动时检查目录。mapper 不拥有 Context、profile、storage domain、Session writer 或模型。

## 接口与顺序

~~~typescript
import { WorkspaceMapper } from 'dsh-codex-bridge/workspace';

const registry = ctx.get('workspaceRegistry');
const persistence = ctx.get('sessionPersistence');
const mapper = new WorkspaceMapper({
  ...(registry ? { registry } : {}),
  ...(persistence ? { persistence } : {}),
}, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });

const plan = await mapper.plan({ originalCwd: historicalCwd });
// 原目录不可用时，由调用方明确选择已有 remapCwd 后重新 plan。
const dry = await mapper.resolve(plan, { dryRun: true });
// 后续真正导入流程显式 resolve(...,{dryRun:false})，成功后用
// returned canonicalCwd 构造 header。Session 创建不是 mapper 的职责。
// Session 已 durable 后才 attach(plan, sessionId, {dryRun:...})。
~~~

constructor 只校验显式 limits、保存 public capabilities，不调用它们或 filesystem。所有写入口都必须传 boolean dryRun；没有默认 apply。plan 天然只读，不需要 dryRun 参数。

| 方法 | 行为 | 允许的接口 |
| --- | --- | --- |
| plan(request,signal?) | 原路径/显式 remap 的只读分类、metadata probe、Workspace 复用建议、冻结 fingerprint 计划 | Node lstat/realpath/stat、public registry.list |
| resolve(plan,{dryRun,signal?}) | 重验目标目录/identity/Workspace，显式创建或复用 Workspace；返回 registry 的 path/id/title | registry.list/create；不 setTitle/initializeDefault |
| attach(plan,sessionId,{dryRun,signal?}) | 已 resolved Workspace 的关联；每次检查 public header/cwd，包括已关联 ID | persistence.stat、registry.list、Workspace.attachSession |
| classifyWorkspacePath(path,style,maxBytes) | 纯路径资格分类，Windows/POSIX 明确参数 | 无 filesystem，URI 不解码/不加载 |

attach 不自行创建 Workspace 或 Session；目标 Workspace 未 resolved 返回 blocked/workspace-not-resolved，未知/缺 cwd/路径不同的 Session 返回 blocked。只有 stat，没有 persistence.open/read/append 或 controller activation。

## 状态和字段

WorkspaceMappingPlan：
schemaVersion:1、当前 Host pathStyle、原 originalCwd 和显式 remapCwd、original/target 分析、status、canonicalCwd、action、existing workspace descriptor、warnings、fingerprint。

- ready：目标实际是目录且 registry capability 存在；action=可以 reuse 或 create 的建议。
- needs-remap：缺失、非目录、无权限、相对/跨 OS/URI/device/invalid/超限或 IO 故障；不会自动 mkdir。
- capability-unavailable：目录存在但没有公开 registry，不能把缺 capability 当空历史。
- original/target.state 区分 missing/not-directory/inaccessible/io-error 等，error message/cause 不透传。
- 显式 remap 时原路径只做纯分类，不访问可能离线的原目录/UNC；标 original-not-probed-during-remap。

操作 result：
status=dry-run/resolved/attached/already-attached/blocked/stale-plan/cancelled/failed；
reason、canonicalCwd、workspace{id,path,title}、effects{createInvoked,attachInvoked}、warnings。

effects 表示 public mutator 是否调用，不代表一定新建或“异常时一定没提交”。create 可能因并发而复用，已提交后 cancellation/path drift 不会伪称 rollback。结果值和计划冻结，live Workspace entity 不出现在返回 JSON 中。

## 路径规则与 authority

Windows 只接受完全限定 drive/UNC，支持盘符大小写、分隔符、尾斜线、中文空格；拒绝 drive-relative/root-relative、device namespace、NUL 与非本机路径。POSIX 接受本机绝对路径，Windows drive/backslash UNC 是 foreign-platform。file:/ssh:/vscode-remote: 等 URI 不自动解码成目录。

输入先做 byte cap/syntax 检查；只有本机 qualified 路径才 lstat → realpath → stat(directory)。不读取文件内容，不 glob、读 .git、加载历史 URI 或创建目录。final symlink/junction 显式标记，parent links 同样由 realpath 解开；不把任意历史路径当 shell 命令。

Workspace 唯一性遵循宿主 fs.realpath 后字符串相等。**不对全部路径 universal lower-case**；实际 SDK/Node realpath 处理大小写，保留 public registry.path 作为 authority。P5 真实 Windows case aliases 已复用同一 Workspace。没有修改宿主路径规则或私有 workspace 表。

resolve 结果的 canonicalCwd 来自 registry 返回的 immutable path；不接受其与已审核 plan 不同的 path。P6/P7 用该 path 作为新 Session.header.cwd，不能先写旧失效 cwd 再“重映射”已导入 header。

## 变化检查与错误边界

plan 保存 real directory 的 dev/ino/birthtimeNs，BigInt 转精确字符串，避免 inode 精度损失；不用容易变化的目录 mtime。resolve/attach 前重新探测 input alias 的 canonical path 与 identity，捕获删除、同名替换、junction 改向等。

已有 Workspace ID 被移除/替换会 stale-plan；create 建议之后另一方创建同 canonical Workspace 可安全复用，returned entity 是实际 authority。关联前必须 stat Session header，其 cwd realpath 与 Workspace.path、目录 identity 都匹配；即使 SDK 对 duplicate attach 省略验证，mapper 也验证。

public mutator 后再次检查目录/registry。若变化发生在已调用 create/attach 后，报告 stale-plan/effects 与 mutation-not-rolled-back；若 API 抛错，可能已提交则 mutation-may-have-committed。不直接删记录/改 header 来回滚。mapper 不写 Session 内容。

AbortSignal 在 native metadata read 前后和 mutator 前检查。Node stat/realpath 原生操作不能强制中断，取消可能需等正在进行的 OS read 返回；之后不继续新写入。public create/attach 无 AbortSignal，调用开始后等待其完成并报告 cancelled-after-...，不谎报零写入。离线 UNC/OS 卡顿没有硬 deadline 保证；只有显式调用会探测，正常 Harness 启动不会等待它。

## 公开 seams 与依赖

- WorkspaceRegistry.list/create：packages/workspace/workspace/src/index.ts。
- Workspace.path/id/title/sessionIds/attachSession：types.ts public consumer interface。
- SessionPersistence.stat：public header observation。
- paths.ts/entity.ts 仅只读实现证据，**没有 deep import**。
- 独立 mapper capabilities 来自宿主，不 new WorkspaceRegistry、storage、session 或 fs service。
- 新 type-facing peer dsh-workspace=0.2.0-rc.2，同版 dev；runtime 没有 workspace SDK import，普通 dependencies 仍仅 zod。Node filesystem only metadata APIs；既有 converter canonical helpers 用于 JSON/fingerprint，不调用 converter 或 writer。

SHA fingerprint 是一致性检查，不是授权凭据。P6 必须绑定已批准计划，P7 仍需保证新 Session header 与 registry authority一致以及 importer 独占 writer/恢复策略。

## 验证与限制

P5 专项测试包含实际目录/缺失/文件/显式 remap、Windows URI/UNC/跨 OS/device/字节上限、中文空格/尾斜线、junction 改向、目录替换、already-attached header 重检、pre/post commit cancellation、mutation fault、caps/bounds。

published rc.2 Host 验证 public create reuse、Windows case aliases、合法 attach/拒绝 mismatch/unknown/no-cwd、dry-run mutator guards、Session log 不变和重启后 membership。built import/constructor 无 eager I/O，plan/resolve/attach dry-run 只有 lstat/realpath/stat 与 public reads，其他写/file-content/network/subprocess APIs 守卫拒绝，含有效负例。

EACCES/EPERM/EIO 用于模拟不可稳定复现的 OS 错误；没有修改本机 ACL。UNC 仅 lexical 测试，没有访问/创建真实 network share。symlink/junction 在 project-owned 目录实际验证；跨 OS 分类是纯输入测试，不等于全平台运行。

没有正式/Dev profile 更新、真实 Codex 历史扫描或迁移、真实模型调用、P6 import plan/dedup、P7 importer 或 Client UI。详细验收在源码工程 docs/P5_VALIDATION.md。
