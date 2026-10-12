# 发布前检查

本仓库以预览项目开源。许可MIT，根0.0.9、可选UI0.0.3；不附带用户真实历史或本机profile。

- 干净克隆：根npm ci/typecheck/test/package:verified；UI npm ci/typecheck/test。全部测试仅合成隔离源。
- 实际tar须有LICENSE、精确peers和预期导出；无SDK runtime、node_modules、ignored证据/secret。
- 独立安装版载体验证normal boot、缺配置、断线/服务替换、页内错误、正常退出/冷重启；UI0.0.3完整新Desktop gate尚未完成。
- 坏Client factory故障不得在正式profile注入。记录SDK初始化阻塞边界与公开禁用恢复，不能假称任意异常安全。
- 原生Session前缀、唯一receipt、确定性ID/duplicate零写入、Workspace/path/未来续聊须读回；只用公开服务。
- 真实单条曾验证；真实批量要另行明确选择和批准，不能将合成批量测试当真实正式批量验收。
- 生产依赖audit只证明当时公开已知漏洞数据库的覆盖，不保证未知漏洞或所有宿主第三方安全。

报告问题时仅提供脱敏步骤、版本、状态码与必要诊断；勿附原会话/密钥/个人目录。本机P0-P15操作记录留在ignored目录/文档，不作为克隆构建的依赖。
