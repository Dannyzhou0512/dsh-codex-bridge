# dsh-codex-bridge

将 Codex 公开历史迁移为 **DeepSeek Harness 原生可续聊 Session**，并关联现存 Workspace。仅支持 **DeepSeek Harness 0.2.0-rc.2**，不兼容0.1.x或其他未验证版本。MIT开源。

这是第三方 Harness 插件；仓库同时提供一个可安装的 **Codex 操作 Skill**，两者用途不同。项目目前以预览形式开放，不承诺任意历史无损迁移或所有插件故障均不影响宿主启动。

## 组件

| 组件 | 版本 | 用途 |
| --- | --- | --- |
| dsh-codex-bridge | 0.0.9 | public reader/converter/planner/importer/recovery/batch 与独立profile CLI |
| dsh-codex-bridge-ui | 0.0.3 preview | 可选侧栏“Codex历史”：浏览、预览、审核、dry-run、显式导入 |
| skills/dsh-codex-bridge | 操作指南 | 指导 Codex 使用已有插件和受信任profile，不包含迁移运行时 |

根Host入口只报告能力，普通启动不连接Codex或迁移历史。CLI仅在专门配置的profile显式启用；UI必须配置可信App Server，writeEnabled默认false。

## 已实现

- App Server非实验thread/list与thread/read；元数据、完整有界预览、公开消息/工具信息/可用reasoning summary。
- 单条和显式选择的串行批量导入；严格dry-run、审核digest、逐项损失确认。
- 确定性Session ID、冲突阻断、来源新鲜度复核；重复导入保留已有DSH续聊。
- cwd存在时注册或复用Workspace；缺失时要求显式映射到已有目录，不自动mkdir。
- 公开SessionPersistence创建/flush/close/完整读回，成为原生Session；不直接修改JSONL/SQLite，不读取Codex私有数据库或rollout。

历史assistant/tool在接受损失后保存为带来源标记的回忆上下文，不伪造模型身份，不重放工具调用；隐藏推理不迁移。详情见[架构](docs/ARCHITECTURE.md)、[字段映射](docs/API_MAP.md)、[限制](docs/LIMITATIONS.md)。

## 安装配套 Skill

将[skills/dsh-codex-bridge](skills/dsh-codex-bridge)目录复制到你自己的Codex skills目录，或用Skill Installer从本仓库安装该路径。示例请求：

> 使用 $dsh-codex-bridge，预览我选定的Codex历史，只做dry-run，暂不实际导入。

Skill不会自动安装Harness插件、切换生产profile或发送模型消息。需要先按[使用指南](docs/USAGE.md)准备插件与专用profile。

## 从源码构建与测试

要求Node.js ^22.19.0或>=24、npm、tar；已验证Node24/Windows。测试只使用项目隔离目录和合成App Server/模型，不访问你的真实历史或生产profile。无需克隆Harness参考源码。

~~~sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run package:verified

cd packages/client/dsh-codex-bridge-ui
npm ci --ignore-scripts
npm run typecheck
npm test
~~~

先构建根包，再安装UI开发依赖。UI通过相对源码依赖引用根包，不依赖本机验收tarball。打包测试创建新的ignored工件目录，不覆盖旧包。开发依赖里的精确SDK版本用于构建/测试；发布插件普通dependencies不包含DSH Core、Cordis或React。

不要把Git源码地址直接当成预构建插件安装：先build/pack，再使用Harness公开Plugin Manager安装生成的tarball。不要复制SDK到宿主资源目录或使用版本豁免。

## 验证状态和剩余限制

核心162项、UI12项以及实际解包回归通过；已验证真实单条导入、原生真实模型续聊和重启/去重。公开仓库只保留合成夹具和脱敏结论，真实会话、截图、配置及本机验收目录不上传。

UI0.0.3已加固断线恢复、服务热替换和写入丢响应处理，仍是预览候选；新版本完整Desktop发布验收未完成。既有renderer崩溃根因未确认。rc.2整个Client factory抛错可阻塞Core前端初始化；公开禁用可恢复，但不能称为任意异常安全。正式真实批量尚未验收。详见[限制与恢复](docs/LIMITATIONS.md)与[发布前检查](docs/RELEASE_CHECKLIST.md)。

## 贡献与许可

请用合成历史报告问题，勿上传真实会话、token、API key或个人目录。参见[贡献指南](CONTRIBUTING.md)与[安全说明](SECURITY.md)。源码采用[MIT许可](LICENSE)，DeepSeek Harness/OpenAI Codex为独立项目，各自许可与服务条款适用。本项目不代表其官方支持。
