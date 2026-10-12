# P12 历史页面设计与边界

目标：独立 companion 将现有 P2/P6/P7/P9 公开 API 接入侧栏“Codex 历史”，完成扫描、公开消息预览、显式选择、目录重映射、逐项转换损失确认、审核、dry-run 和单条/串行批量导入。主插件保持 0.0.9；companion 0.0.2。仅项目内合成/隔离验收，不更新正式或 Dev，不新增真实迁移或模型消息。

信息层次：连接与来源状态 → 刷新/归档筛选 → 历史选择列表 → 单条公开预览 → 每条现存目录 remap/损失确认 → 只读审核结果 → dry-run → 明确实际导入 → 逐项结果。列表计数未知显示“预览后统计”，不伪造零。

布局：沿用宿主 React/Button/theme，桌面列表+详情两栏，窄屏单列，紧凑行和边框，无装饰卡/新 UI 框架。长路径、文本和错误换行；公开工具字段只作为文本，绝不执行或 innerHTML。中英文 locale。

组件树：CodexHistoryPage → ConnectionState / HistoryBrowser(ListToolbar, ThreadRows) / ThreadInspector(PublicPreview, MappingInput, LossChoices) / ImportReview(PlanRows, DryRunAction, ExplicitWriteAction) / ImportResults。主页面继续由公开 main/sidebar slots 注入。

状态：初始 loading；未配置/错误配置；扫描 loading/empty/error+retry；预览 loading/error；选择上限；缺能力/needs-remap/needs-review/unsupported/conflict/already-imported；审核过期/变更；dry-run failed/partial；写入禁用；运行中全部审批控件禁用；晚到结果/卸载抑制。640px 以下两栏叠放、工具栏换行、触控控件至少36px；键盘可达、有标签和 aria-live。

| 风险 | 修正 |
| --- | --- |
| 原型看似可导入却未接后端 | 所有动作接真实生成 Remote；默认禁写并明确原因 |
| 堆叠指标/卡片稀释历史 | 行式历史和单一详情，时间/状态/目录直接展示 |
| 超长历史拖垮 UI | 有界扫描/选择/计划/预览，截断明确告知，不影响转换完整性 |
| 模糊审批导致错误写入 | 列出每项 ID/目标/损失，变更即失效，先 dry-run 后确认写入 |
| 一个窗口操作干扰另一个 | 不启动另一套同锁 Desktop；只使用 owned Web/SDK Host 验收 |

Host 配置是管理员可信 profile 配置；浏览器不能指定 executable/codexHome/启动 args。默认未配置，不启动子进程、不打开 persistence。writeEnabled 默认 false，不能通过 RPC 开启。公开 RPC 固定方法/严格生成参数；来源来源仅稳定历史 adapter。

Host 全局串行操作（同实例避免并发），最大20项、8份审核（超限淘汰最旧句柄）、10分钟有效期；审核句柄随机、只保存 Host 签发的原 BatchPlan 和原 planner，不接受客户端反序列化计划。句柄是已认证 UI 内的临时 bearer capability，不声称按用户/连接隔离；不适合把共享认证 Host 暴露给不可信用户。实际写入一次性消费；RPC 响应丢失须重新 plan 识别已有/partial，不能无脑重试。Host卸载中止请求并等待当前 writer 收尾、reader关闭。后端异常只回有限通用代码，不返回 raw stderr/凭据。

P12 不新增 writer 或自动恢复：复用 BatchImporter 的 source/provider/target/path freshness、全批前置审批、serial apply、重复识别及部分写入报告。没有目录创建、private file 写入、主动模型续聊或自动安装。UI 完成 dry-run 后，仍须点击确认实际导入；Host 再检查 digest/已确认损失，底层再次复核。完整 Desktop 可视验收仍作为独立 release gate，不以 DOM 模拟代替。
