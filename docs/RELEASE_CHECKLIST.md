# 发布前检查

本仓库以预览项目开源，许可证为 MIT。当前主插件 0.0.10、可选 UI 0.0.9，目标宿主 DSH 0.2.2-rc.3。发布材料仅包含合成夹具和脱敏结果。

- 干净克隆：根npm ci/typecheck/test/package:verified；UI npm ci/typecheck/test。全部测试仅合成隔离源。
- 实际tar须有LICENSE、精确peers和预期导出；无SDK runtime、node_modules、ignored证据/secret。
- 新宿主版本只有在安装包通过版本检查、公开会话服务完成导入和重启读回、旧回执去重通过后，才列入[配套 Skill 的兼容基线](../skills/dsh-codex-bridge/references/workflow.md#compatibility-before-history-access)。单独记录已验证的 Codex App Server 版本和 UI 预览状态。
- 独立安装包验证正常启动、缺配置、断线、服务替换、页内错误与冷重启。Web 与 Electron Desktop 验收分别记录。
- 坏Client factory故障不得在正式profile注入。记录SDK初始化阻塞边界与公开禁用恢复，不能假称任意异常安全。
- 原生Session前缀、唯一receipt、确定性ID/duplicate零写入、Workspace/path/未来续聊须读回；只用公开服务。
- 真实单条曾验证；真实批量要另行明确选择和批准，不能将合成批量测试当真实正式批量验收。
- 生产依赖audit只证明当时公开已知漏洞数据库的覆盖，不保证未知漏洞或所有宿主第三方安全。

报告问题时仅提供脱敏步骤、版本、状态码与必要诊断；勿附原会话/密钥/个人目录。本机P0-P15操作记录留在ignored目录/文档，不作为克隆构建的依赖。
