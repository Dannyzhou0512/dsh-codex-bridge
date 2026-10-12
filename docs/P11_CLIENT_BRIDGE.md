# P11：独立 Client companion 接入

已交付独立dsh-codex-bridge-ui 0.0.1源码与final tar，父dsh-codex-bridge保持0.0.9。P11提供sidebar/main“Codex 历史”诊断页面及只读Host status，验证第三方构建、生成Remote、真实Gateway通信、错误降级和卸载。列表/预览/remap/审批/apply属于P12，尚未启用；没有自动读取真实Codex或迁移数据。

## Public API 与独立构建

- @deepseek-ai/dsh-typert-protocol：标准@Remote及bindTypertRemote(this,serviceKey)。Host是named function plugin提供plain service，避免同时混用default Service和named exports。
- @deepseek-ai/dsh-typert-generator：公开WorkspaceTypertGenerator.generate，仅host face严格分析，生成./typert与./remote；没有手写或改生成描述符。
- @deepseek-ai/dsh-api-remotes/client、gateway/client：显式$mount生成contribution，解包RemoteResult；页面caller单独inject remote与remote.codexBridgeUi，装配owner先mount再启用caller，避免循环等待。
- ui-renderer/client SlotRegistry、ui-layout/client MainPanelId、ui-sidebar/client slots、client-locale/client：注册自有codex-history panel与导航，主页面不替换core UI。
- React与ui-primitives：ModuleLoader factory external，UI使用宿主Button/theme tokens；Node builtin与父插件reader/importer不进入browser graph。

公开generator默认workspace识别不了未登记的npm SDK Remote符号。独立build在本插件node_modules仅新增分析tsconfig，引用真正已发布SDK d.ts；不改SDK代码、d.ts或manifest，不写参考目录。TypertRemoteService继承分析还依赖源树出口，因此改用公开显式bindTypertRemote并为DTO暴露./shared子路径。没有伪造ambient协议类型、关闭strict检查或导入参考私有tsdown.client helper。

Host/Client分开tsconfig，host aggregate只用于本项目mini-workspace分析。esbuild将client产物封装为SDK公开window.__ModuleLoader__.load({id,factory})格式；React/JSX/primitives外部化，Zod是普通依赖。全部DSH/Cordis为精确peer+dev=rc.2/4.0.4；无0.1.x Core或ordinary Core runtime。

## 状态、边界与生命周期

status仅返回固定版本、sourceState=not-configured、importEnabled=false和三项能力presence，不调用Session/Workspace provider，不暴露路径、exe、token或配置。presence不代表后端完整健康或可执行导入。

页面有loading、not configured、能力缺失、Remote unavailable+retry、刷新disabled与focus-visible；响应revision与unmount抑制晚到更新。中英文locale，文本输出，无innerHTML。页面单列在640px下header换行/触控按钮增高，长文本wrap，dark/light随宿主tokens。Slot/style/locale/Remote由owner fiber清理，unload后捕获旧方法返回失败。

Host不启动Codex、不开Session writer或Workspace，不修改P1 Root/CLI。P11尚无写入RPC，所以不把status按钮宣传为dry-run；P12将接同一P6/P7/P9而不复制importer。底层加载错误仍须release smoke，不保证任意坏client bundle都不会影响宿主启动。

## 包与操作

源码：packages/client/dsh-codex-bridge-ui。final包：.artifacts/p11/final/dsh-codex-bridge-ui-0.0.1.tgz，16entries、122,948bytes，SHA256=6c0eb3c1ec2ff49efd8f0c0f01e1828140266e2e6e6196a819ea42f3c9a7a7a8。先前candidate保留用于本地诊断，不作为安装结果；九个原主包保持不变。

~~~powershell
npm run build --prefix packages/client/dsh-codex-bridge-ui
node --test packages/client/dsh-codex-bridge-ui/tests/*.test.mjs
# 独立pack必须从companion目录运行，npm pack --prefix不选择该package。
~~~

独立companion不装进原正式/Dev profile，本轮仅通过安装版dsh plugin manager安装到项目 .artifacts/p11/web-home/profiles/p11，base+web-app+companion。所有SDK bootstrap/profile/cache/store/state均在项目内。安装版Desktop CLI carrier提供真正Web Host，验证实际广告的revisioned组合资产与status HTTP RPC。
