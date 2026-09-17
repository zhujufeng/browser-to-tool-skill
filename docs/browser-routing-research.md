# 浏览器选择与会话连续性

2026-09-17核对。此次修改是Skill工作方法，不新增连接器，不改变配套运行器协议，不操作个人浏览器。官方资料核实的是产品能力，不能代替当前安装版本与模型实际行为验收。

## 结论

| 用途 | 默认选择 | 理由与边界 |
|---|---|---|
| 已登录后台、真实接口调查 | 获准且够用的现有会话；Codex桌面先核查官方Chrome扩展 | 复用原登录态，减少重登及会话差异；仍需验证网络、先行过滤和请求能力 |
| localhost/公开页面/界面预览 | 已有内置浏览器 | 不必接管日常profile；有自己的浏览器状态 |
| 缺少可用通道或明确不接管个人浏览器 | 获准的专用Playwright | 可控的独立环境；首次登录及依赖可能有额外成本 |
| 扩展故障注入、空存储和缓存隔离 | 独立Chromium合成测试 | 这是测试用途，不是把真实业务会话反复搬来搬去 |

先识别客户端、桌面/终端/IDE或远程形态、实际工具与执行位置，再在可用通道中按用途选择；客户端分支集中在[适配说明](../browser-to-tool/references/clients.md)。不能把终端没有默认内置浏览器误写成永远不支持已有浏览器集成，也不向其他客户端套用Codex设置。

已选择并验证的通道优先保持。Skill不要求每次逐一试完三种浏览器；政策拒绝也不能转成换工具绕过的理由。具体执行规则集中在[浏览器说明](../browser-to-tool/references/browser.md)。

## 一手依据

### OpenAI浏览器与Developer mode

- 原入口：[内置浏览器](https://developers.openai.com/codex/app/browser)、[Chrome扩展](https://developers.openai.com/codex/app/chrome-extension)。本次读取跳转到官方ChatGPT Learn的Browser / Browser extension文档；名称、设置入口可能与已安装旧版不同。
- Browser原文：`Developer mode works with Computer Use in Chrome and the built-in browser.` 并明确可 `inspect console output and network traffic`。
- 同页说明完整CDP需要明确批准，组织可以禁用；内置浏览器使用独立profile，不自动共享日常浏览器的标签或会话。
- 扩展页说明可读取/操作已经登录的网站，安装权限包括`Access the page debugger`，并有站点批准及组织限制。
- [组织管理](https://developers.openai.com/codex/enterprise/managed-configuration)说明`browser_use_full_cdp_access = false`可禁用完整CDP；本地配置不能放宽组织拒绝。

**支持的结论：** 官方扩展并非只有点击/截图；获准Developer mode可以检查网络。

**不支持的结论：** 当前用户的安装版本一定开放相同API；扩展默认会过滤所有秘密；允许截图就批准全CDP；Codex CLI、Claude Code、Pi或OpenCode自动具备桌面扩展能力。这些均需实际工具与权限证据。

### Chrome调试传输

[官方chrome.debugger文档](https://developer.chrome.com/docs/extensions/reference/api/debugger)说明其是remote debugging protocol的`alternate transport`，可以按tabId附着并观察network interaction，允许Network域，并提供`detach`。

因此没有9222端口不能证明官方扩展没有网络能力。扩展调试、Chrome远程调试设置、MCP直接CDP连接是不同接入方式，不能混为一套安装前置条件。底层Chrome支持某方法也不等于宿主包装已经暴露它。

### Playwright生命周期

[Browser.close文档](https://playwright.dev/docs/api/class-browser#browser-close)区分launch得到的浏览器（关闭浏览器及页面）与连接到的浏览器（清理创建的上下文并断开）。不能仅凭函数名判断所有库、连接方式和默认上下文都可安全关闭。

本Skill配套运行器拥有自己的专用浏览器，不是个人Chrome通用连接器。借用会话的清理先在自建无登录环境验证；不得在个人浏览器试验关闭行为，也不能用私有API、调试器热改或强杀补救。

## 从开发记录提炼的通用问题

可见聊天不是工具轨迹：没有工具调用/输出时，“已确认”仍可能只是助手的错误归因。这里只保留方法教训，不收入原对话、账户、业务接口或数据。

- 空监听可能来自旧文档、错过触发、iframe/worker或缓存覆盖；先取得区分假设的证据，不连续重启与改猜测。
- HTTP200可能是业务认证失败；浏览器关联请求未必具有页面动态认证能力，页面fetch仍是HTTP方案，不必迁移登录。
- 接口一次全量、UI本地分页是真实可能的模式，不能机械要求制造第二页请求。
- 页面函数通过不等于扩展通过；版本缓存和旧完成记录会制造假成功，需要核对加载版本、本轮runId和新保存记录。
- JSON技术字段全部展开不等于用户需要的CSV；全量前先核对固定业务列、单位和合法空值。
- 调查与测试可以有两个环境，但用途必须明确；截图与导出验证应复用已有会话/记录，不触发额外全量。

## 验证边界

本轮可运行维护检查只验证文档引用、策略文本、脚本语法和隔离目录操作；它不是模型行为测试。新增场景覆盖扩展无端口、CDP拒绝、空监听、预览/隔离测试、本地分页和导出语义，状态保留待运行。未对用户已登录浏览器做实站探测，也未验证当前Codex安装版本的网络过滤实现；不能宣称已经测通官方扩展。
