# 使用指南

先确认Harness版本恰好0.2.0-rc.2。使用新隔离home/profile验证，再考虑经明确授权的目标环境；安装和运行使用公开Plugin Manager/launcher，永不patch核心或手改Session文件。

## 构建与安装

根目录npm ci --ignore-scripts、npm run package:verified生成新的已验证tar路径。可选UI先在根目录build，再到packages/client/dsh-codex-bridge-ui安装开发依赖并npm test，输出新的UI测试tar路径。用你的已安装dsh公开plugin管理器安装这些本机tar；不要把Git URL直接当built bundle，不自动安装SDK peers。

## UI

按[UI_CONFIG_EXAMPLE.json](UI_CONFIG_EXAMPLE.json)配置受信任reader，并替换三个示例路径为现存本机路径；默认writeEnabled=false。启用仅表示允许明确操作，不会自动扫描或导入。

Codex历史→扫描→预览并核对thread id/cwd→显式勾选→接受实际需要的损失→审核→dry-run。原生目标已存在时应识别already-imported；不是错误。需要实际写入时才配置writeEnabled=true，再对同一审核勾选确认、执行。收到结果不确定提示时重新审核同一目标；不得直接重试旧写入。

## CLI

专门的codex-import profile选择根bundle并挂dsh-codex-bridge/cli行；其public SessionPersistence/Workspace后端必须指向你确认的同一个目标数据集，否则只会导入另一个隔离集合。配置对象见[P10_CLI_CONFIG_EXAMPLE.json](P10_CLI_CONFIG_EXAMPLE.json)，服务挂载结构见[P10 CLI API](P10_CLI.md)。根bundle自身只有健康服务，不自动挂应用parser。

~~~text
dsh --profile codex-import list
dsh --profile codex-import preview --thread THREAD_ID --mode recall
dsh --profile codex-import plan --thread THREAD_ID --mode recall --accept-loss assistant-role-recall --accept-loss tool-information-recall
dsh --profile codex-import apply --thread THREAD_ID --mode recall --accept-loss assistant-role-recall --accept-loss tool-information-recall --dry-run
~~~

示例的两项loss不是全局默认，也不适用于所有会话；以每条预览的requiredLosses为准。cwd缺失需--remap EXISTING_ABSOLUTE_DIRECTORY，不创建目录。确认实际目标/选择/损失与dry-run后，使用同一参数加--execute --reviewed-digest PLAN_REVIEW_DIGEST；--execute与--dry-run冲突。launcher的--profile在业务参数之前。

导入后通过宿主原生Session打开、Workspace关联和正常重启读回检查。发送真实模型验收消息须另在已授权范围内进行；工具/历史内容不由迁移自动执行。
