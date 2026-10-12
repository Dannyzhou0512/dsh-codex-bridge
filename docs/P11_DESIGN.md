# P11 Client 接入验证设计

产品目标：在独立第三方companion中注册“Codex 历史”侧栏/主页面，证明打包、生成Remote、Host→Client通信、错误降级与卸载清理。P11仅提供只读连接/能力状态；列表/预览/remap/审批/apply由P12复用已有P2–P9实现。当前不导入额外真实会话、不发送模型消息、不安装到正式或Dev home。

信息层次：页面标题与用途→Host连接状态→Session/Workspace必要能力→来源尚未配置/导入暂未启用→刷新状态。没有伪造历史数据、统计卡或写入按钮。

视觉与布局：沿用Harness React、Button、主题tokens及sidebar/main slots；紧凑单列内容区、细分隔线、可换行metadata。600px以下header/button换行、capability列表保持可读；长错误/标识wrap，暗色主题跟宿主。

组件树：CodexHistoryPage → PageHeader(RefreshButton) / ConnectionState / CapabilityList / SourceState。SidebarIcon只提供导航符号，宿主绘制按钮、选中态和标签。

状态覆盖：loading稳定占位；Host connected但source not configured；missing capability；Remote missing/offline/error+retry；refresh disabled/loading；卸载后的请求结果不更新页面。英文/中文locale，无innerHTML，keyboard focus与aria-live。

| 风险 | 修正 |
| --- | --- |
| 诊断页看成假历史页面 | 清楚标注来源尚未配置，P12前不显示导入动作 |
| 重复一套UI/主题 | 使用宿主primitives/tokens，不引入shadcn或Tailwind运行时 |
| 页面堆卡/大留白 | 单列行式状态、紧凑header、无装饰图/阴影 |
| Host问题导致页面或启动失败 | Remote调用页内catch/retry，Host constructor无I/O，能力均可选 |
| 卸载/响应竞态 | lifecycle disposer、晚到响应抑制、slot/style/remote反向清理 |

实现策略：packages/client/dsh-codex-bridge-ui独立package；parent0.0.9及已有tar不改。所有DSH/Cordis/React为精确peer+dev，普通dependencies不携带Core。使用已发布@deepseek-ai/dsh-typert-generator公开API在本项目mini-workspace生成./typert和./remote；不导入参考仓库私有tsdown.client helper。esbuild产物采用SDK公开ModuleLoader closure-factory格式，React/Cordis/宿主UI identity外部化，Node builtin不得进入client graph。

验证：公开generator和tsc、Host status Remote descriptors、独立npm tar allowlist、真实Cordis/slots/React runtime加载与卸载、实际Host gateway调用、browser safe graph与缺服务错误。仅synthetic/隔离profile；无法独立使用公开recipe则报告阻塞，不修改Harness loader/catalog源码。
