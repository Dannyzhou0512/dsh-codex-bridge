# 开源前验证

日期：2026-10-12（Asia/Shanghai）。主插件0.0.9，可选UI0.0.3 preview，MIT；同时包含独立Codex操作Skill。

| 验证 | 结果 |
| --- | --- |
| 主插件类型与完整合成回归 | 162/162，通过 |
| UI生成器、类型与全部回归 | 12/12，通过 |
| 仅含公开提交的干净克隆 | 根npm ci/typecheck/test/package:verified通过；UI npm ci/typecheck/test通过 |
| 实际发布包 | 含MIT LICENSE，严格文件/依赖边界与实际解包行为检查通过 |
| 配套Skill | frontmatter、命名、引用结构校验通过 |
| 发布内容检查 | 不包含真实历史、截图、profile配置、token、个人路径、node_modules/lib或本机验收工件 |

干净克隆检查发现并修复了本机tar依赖、SDK类型重复、UI必需tsconfig误忽略，以及Remote类型首次生成顺序。修复发生在开发/打包流程；没有修改Core源码、参考快照或正式/Dev环境，没有新增真实导入或模型消息。

本仓库是预览项目，不作为稳定UI发布公告。新的UI0.0.3完整Desktop验收尚未完成；既有renderer崩溃根因未确定，整个Client factory损坏的rc.2初始化阻塞边界仍在，正式真实批量仍未验收。详见[LIMITATIONS](LIMITATIONS.md)。测试通过不是“任意故障零风险”的保证。

真实单条、原生真实模型续聊、正常重启和去重曾通过；原始本机记录不公开。维护者复现时使用合成夹具，真实来源操作需明确范围并单独审核。
