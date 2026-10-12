# 限制与恢复

仅适配DSH0.2.0-rc.2；Core/Cordis/React精确peer由宿主提供，禁止0.1.x混装或绕过版本检查。UI0.0.3是预览候选，源码/SDK/实际tar测试不等于完整Desktop部署验收。

## 数据保真

assistant/tool/公开summary按逐项接受的recall政策保存；缺附件、未知item、工具输出缺失和compaction原状态不能无损恢复。必须在预览与审核确认每项损失。仅处理完整公开历史；活动/不完整来源保守拒绝。线程最新模型信息不能当逐条模型归属。

App Server测试样本来自alpha二进制，RPC使用experimentalApi=false；不保证任何未来版本。deprecated全量read若不再支持，插件应报不支持，不绕过私有状态。

## 提交与并发

写入不是全批次原子事务。SDK/OS故障可留下partial Session或workspace-pending；不删除原数据、不换ID掩盖失败、不自动rollback。响应丢失可能已提交，重新审核同一thread/确定性目标来判断状态，不能直接盲重试。UI0.0.3会清除旧dry-run结果并提示不确定性。

局部liveSession检查不证明所有进程均不活跃；reviewDigest不是全局锁。UNC/慢文件系统调用不保证硬中断。GUI正常打开/重启可能追加宿主恢复/权限事件；应检查导入前缀和已有续聊保留，而不是要求总事件数永远不变。

## 启动风险

普通Host缺配置、缺能力或操作失败可降级，不自动开始迁移。已测整个Client factory抛错仍会让rc.2 Core前端初始化失败：没有已验证的公开“初始化失败可忽略”声明，不得patch核心来掩盖限制。

出现初始化失败，可使用已认证的宿主公开Plugin Manager禁用dsh-codex-bridge-ui bundle，保留CLI与原生Session；已有公开禁用/重装/冷启动恢复实测。不要修改私有持久化文件或删除会话。若“任何Client损坏也必须正常启动Core”是硬性要求，暂用CLI路径。

已有renderer崩溃日志仅提供crashed等有限信息，根因未知；无法排除插件/第三方组合/交互相关性。后续普通点击、真实续聊和冷重启成功不构成永久修复。不要在生产故意注入坏包复现。

## 权限与隐私

Host配置的executable/profile/目标后端为可信边界，浏览器不能任意提供启动命令。审核handle是同一认证Host内bearer，不是多租户隔离。dry-run指迁移零写入，不包括宿主启动和包管理器的正常活动。

未来续聊遵循Harness当前权限和模型策略；插件不自动重放历史工具，也不保证模型今后永不调用工具。真实批量、更多来源/大历史、缺失cwd等应逐项另行验收。
