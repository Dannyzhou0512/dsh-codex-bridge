# P10：专用 profile CLI（0.0.9）

已交付显式 opt-in dsh-codex-bridge/cli 应用入口。正常 bundle patch 仍只插入 P1 Host 健康服务，不自动挂 CLI、不解析 Desktop/TUI/Web 参数、不启动 Codex。没有插件 bin、SDK argv 逃逸或宿主源码修改；所有 Node app 启动由既有 dsh profile launcher 拥有。

## 启动、退出与结构

CLI是named function plugin（name/inject/apply，无default），与Root default Service分开。专用 profile 行才显式配置 enabled:true；缺省/false时连CmdlineArgs.get都不调用。

public @deepseek-ai/dsh-cmdline提供ctx.cmdlineArgs/parseCmdline、appReady.onReady、appExit。Commander动作只同步记录已接受的调用，只有launcher提交ready后才执行。operation自有AbortController、finally await reader.close；正常输出后请求publicappExit。unload/dispose取消ready、abort当前operation并awaitsettlement。插件不process.exit，不接管launcher信号。

--profile / --patch / --dump-config / --dump-config-schema / --version属于launcher，要在app args前；--help在profile后属于本应用。--version仍打印DSH rc.2，插件自己的--bridge-version打印0.0.9。rc.2可警告跳过未激活可选行，不代表fatal startup；actual malformed patch拒绝时ready不提交，Codex不启动。

## 操作与同一执行层

所有业务stdout最后一行是JSON，包含schemaVersion=1、action、dryRun、profile和payload或有限error。Host/launcher日志可能另行输出，工具消费应识别schemaVersion/action对象，不将日志当JSON协议。SDKlauncher bootstrap/准备profile可普通写入；strict dry-run指迁移不create Session/Workspace/cache/domain，不能承诺整台Host磁盘零活动。

- list：P2 reader.list，固定stable-surface handshake/非实验历史接口；--source-kind repeat、--archived。counts=null表示未hydrate，不显示成0。
- preview：P6/P9只读规划后公开消息预览、source metadata、hydrated counts、warnings、requiredLosses/blockers。
- plan：完整BatchPlan及reviewDigest，只读，保留每项原审批材料与directory/target observations。
- apply：缺--execute时默认dry-run，--dry-run显式可用；--execute与--dry-run冲突。实际写入要求--reviewed-digest为同一选择/政策/配置/profile和当前计划的reviewDigest，再使用P9整体与leaf审批执行同一P7 importer。

每条使用--thread <id>，可重复，P9去重；没有隐式导入全部。--mode strict|recall可覆盖显式profilepolicy；--accept-loss <code> repeat才确认损失，profile配置不能预置acceptedLosses。--remap <existing cwd>对本次所选threads统一指定已存在目录，不mkdir；不同目标或政策应分次plan/apply，或使用P9 programmatic per-item API。

reviewDigest = versioned hash(public launcher profile name/home/dir/bundles + checked CLI config digest + current BatchPlan digest)。执行时在新进程重新plan，绝不把跨进程JSON当P6原对象。哈希是意图/一致性，不是认证或锁；当前profile服务由launcher拥有，SDKbackend私有配置不在插件读取范围，不能证明所有底层配置跨调用未变。操作者应确认profile与其backend配置，真正writer仍由当前P7provider绑定。source/target/path/配置变化导致review-stale，不自动放宽审批。重新导入完整会话需新plan digest，结果alreadyImported不吞DSH tail。

缓存政策由专用profile显式cache配置skip或refresh-if-available提供；normalRoot不启用。当前CLI不暴露P8 recovery command，后置失败可用P8独立API；没有slash command（避免command框架自身日志混淆dry-run）。没有Client UI。

## Exit codes与错误边界

0=成功scan/preview、可执行plan、成功/duplicate/dry-run batch；1=Commander usage、配置/能力/source/review/output错误；3=plan/apply含阻塞/partial；130=本操作取消。launcher自己的SIGINT也130、SIGTERM为0且有5秒teardown上限，最终信号语义归launcher。

输出不包含RPC raw errors/stderr/cause/隐藏reasoning。异常写入后无法得到结果时outcomeMayHaveCommitted=true，不假称rollback。batch/leaf完整结果继续包含阶段、closed writer facts、Workspace/cache状态。publicreader.close在任何路径await；shutdownTimeoutMs配置最多4000，给launcher5秒grace留余量，但网络FS/SDKwrite不能保证硬abort，超grace可由launcher强制结束，部分目标需后续诊断。

输入argv投影前总byte budget，完整输出UTF-8预算显式；执行前给BatchResult预留完整预算，避免注定无法报告还先写。帮助/grammar不需有效reader配置，不启动transport。

## 专用配置（仅隔离指南，本轮未安装）

配置对象完整参数：enabled、reader（P2 options）、scan、conversion（mode/titleMode/limits，禁止acceptedLosses）、mapping/planning/importing/batch显式limits、cache、io.maxArgBytes/maxOutputBytes。完整可校验占位示例见 P10_CLI_CONFIG_EXAMPLE.json，三个reader路径必须替换为可信且存在的本机位置；示例数值只是明确配置例，不是隐藏默认，需按数据量调整。Config由本app运行时Zod验证，普通CMD help仍可用。要使用公开稳定history reader而非桌面SQLite/rollout。

安装/配置review可在插件 .artifacts/manual-cli-home 内创建独立DSH_HOME，不能指向正式/Dev home。专用profile package.json形状：

~~~json
{"name":"dsh-profile-codex-import","private":true,"dsh":{"profile":{"bundles":["dsh-codex-bridge"]}}}
~~~

profile/node_modules下放已经build/pack的此bundle（或由宿主plugin manager管理），普通Root.patch自动只加载健康服务。profile自己的cordis.patch.yml通过insert提供publicSDK服务及专用app行：

~~~yaml
- insert:
    - id: session
      name: '@deepseek-ai/dsh-session'
    - id: storage
      name: '@deepseek-ai/dsh-storage'
    - id: storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: <isolated-home>/storage
    - id: storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config: { backend: json }
    - id: persistence
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: <isolated-home>/sessions
        compression: zstd
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: codex-import-cli
      name: dsh-codex-bridge/cli
      config: <完整CliConfig对象>
~~~

不要与TUI/Web的app-owned parser放同一profile；普通Root服务可同时存在。SDK版本均为0.2.0-rc.2并从宿主安装解析，不能把0.1.x核心放进插件dependencies。正式部署还必须明确与目标Desktop使用同一public backend位置，否则会导入到另一个隔离数据集；本轮没有部署这一步。

命令形状（本轮仅fake server执行，真实路径需操作者配置）：

~~~powershell
dsh --profile codex-import --help
dsh --profile codex-import list
dsh --profile codex-import preview --thread <id> --mode recall --accept-loss <required-code>
dsh --profile codex-import plan --thread <id> --mode recall --accept-loss <required-code> --remap <existing-dir>
dsh --profile codex-import apply --thread <id> --mode recall --accept-loss <required-code> --remap <existing-dir> --dry-run
dsh --profile codex-import apply --thread <id> --mode recall --accept-loss <required-code> --remap <existing-dir> --execute --reviewed-digest <plan-reviewDigest>
~~~

所有必需loss须逐个repeat接受；上例只是命令形状，不意味着只一个code就能执行。Codex executable/args/codexHome/cwd属于可信profile配置，CLI不会接受任意RPC或读取private storage。real reader config示例：executable=<trusted codex.exe>、args=[app-server,--stdio]、cwd=<existing dir>、codexHome=<explicit home>；所有timeout/frame/history/转换/结果limits应依据数据量显式配置。可先 npm run test:p10 验证完全隔离的正式launcher流程，自动ownedroot与teardown，无正式profile安装。

## 依赖与验收

ordinary dependencies仅zod4.6.5+commander15.0.0；新增dsh-cmdline精确peer+dev=0.2.0-rc.2，实际dsh launcher@rc.2仅dev，核心不打入tar。不导出bin/install脚本，Root保持只Cordis import。开发launcher带来其SDK/UI依赖仅node_modules/dev tree，实际archive严格allowlist；Core packages按路径边界验证rc.2/dev，不把其nested第三方包误当Core。

10项actual published dsh lib/bin.js测试：help/usage/bridge-version、scan/preview、plan/dry-run/reviewed single+batch apply、跨进程rerun、source drift/output cap、missingexe/timeout与forcedchildclose、Windows中文空格path、disabled face/fatal startup gating、CLI产生Session在fresh真实Host卸载bridge后native turn2+model-visible history。仅source/model synthetic；所有profile和写入在插件owned roots。

完整Desktop/User-install、真实Codex历史迁移与真实模型HTTP未执行。可选P11/P12 UI不属于本轮；核心CLI方案需最终真实历史的隔离端到端验收。证据见P10_VALIDATION.md。
