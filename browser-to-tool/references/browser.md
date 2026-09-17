# 浏览器调查说明

## 先选用途，再固定通道

先按[客户端识别表](clients.md)确认客户端、运行形态、真实工具及执行位置，以下优先级只在当前会话可用且获准的通道中选择。

**已登录后台优先复用获授权的现有会话；有该能力时，本地预览优先内置浏览器；Playwright用于确有缺口或隔离测试。** 这不是要求每个任务把三种浏览器轮流试一遍。续作时已有通道满足要求就继续，即使另一种名义上优先级更高也不迁移登录。

| 本轮用途 | 优先选择 | 何时换方案 |
|---|---|---|
| 已登录后台的接口调查、真实小样本 | 已获准且能力足够的现有连接；Codex桌面优先核查官方Chrome扩展 | 按下节核实具体缺口，说明影响并取得必要授权后才换 |
| localhost、公开页面、界面预览 | 已有内置浏览器；没有则复用已有合适工具 | 不为无登录需求的页面接管个人Chrome |
| 无可用会话、用户明确不要个人浏览器 | 获准的专用Playwright浏览器 | 首次由用户登录，后续复用同一profile/session；不复制Cookie |
| 扩展安装、缓存隔离、故障注入与合成回归 | 独立Chromium测试环境 | 与真实调查并列标注，不把业务会话搬过去，不把合成通过当实站通过 |

浏览器会话和请求方式是两件事：页面fetch仍然是HTTP取数；换成关联请求客户端不一定需要换窗口。先按[HTTP采集路线](http-collection.md)验证网络观察、先行过滤和请求执行能力。仅能截图/点击不是完整采集通道，但不代表必须立即新开浏览器。

### Codex官方扩展能否监听接口

仅当前会话实际提供Codex桌面浏览器工具时适用。终端/IDE不自动具有该能力，其他客户端使用自身集成文档，不执行本节设置流程。

官方浏览器文档说明：**Developer mode适用于Chrome扩展和内置浏览器，提供受控CDP访问，可检查网络流量。** 因而“扩展只能点页面”“个人Chrome没有9222端口所以扩展不能监听”都不是有效判断。Chrome的`chrome.debugger`本身是另一种协议传输方式；但底层API支持不证明当前宿主已暴露该API。

开始只检查当前宿主提供的浏览器工具说明、版本、连接状态及本轮授权页，不扫描个人配置、所有标签正文或端口来代替能力核验：

1. 区分Codex桌面扩展、内置浏览器、CLI的MCP与直接CDP连接；不是安装了Codex CLI就一定拥有桌面扩展。读取当前工具的实际文档，不猜`browser.*`调用或把Playwright API套在它上面。
2. 检查当前版本的Developer mode/full CDP能力及站点批准状态。需要设置时说明用途，请用户在宿主正规入口处理；安装扩展、启用调试和站点授权不是同一件事。组织禁用或用户拒绝时停止相关访问，不能换连接器、端口或profile绕过。
3. 能读网络仍不代表能安全读网络：确认事件订阅、对应响应读取、**模型返回前的本地过滤**和查询执行能力。先在无真实账户的合成内容上验证过滤。若工具会先把完整头/正文交给模型，记录为不满足，不能事后删报告补救。
4. 在本轮批准范围内先挂监听，再触发最小查询，核对请求关联与过滤后的结构。文档支持、工具已开放、实际验证分别记录；成功后沿用该通道，不再为找接口启另一套浏览器。

OpenAI文档入口可能随产品更名跳转；以当前安装版本的工具说明和官方权限流程为准。这里没有附送Codex连接器，也没有宣称四客户端都可调用Codex扩展。

### 会话连续性与切换门槛

在已有`工作记录.md`用一行记录：用途 / 宿主及通道 / 本轮页面ID / 借用或自建 / 授权范围 / 已验证能力 / 当前阻塞。只留安全标识，不保存调试端点、连接令牌、原始标签清单或完整敏感URL。每个业务文档同一时刻只设一个主动控制/观察者，避免不同工具争抢导航与调试会话。

- **空监听先诊断，不先换浏览器。** 查当前页/文档是否因登录变化、监听是否早于请求、Fetch/XHR类型、已授权iframe/worker与缓存覆盖；通过一个能区分假设的安全动作验证。跨域网关只因来自页面不自动获准；需要扩大范围时先批准。未验证归因写“假设”，不能连续把跨域、旧文档、MIME等都称为已确认根因。
- 确实要换时，先记录原通道的具体失败证据、替代通道能解决什么、是否需要重新登录/新增权限。保留旧窗口与任务成果，先释放自己监听，获准后再建立新连接；新通道重确认范围，不沿用旧候选ID。政策拒绝不是技术缺口，不能靠换工具继续被拒访问。
- 借用页面只移除自己监听并按已核实API断开；**不调用浏览器/默认上下文关闭，不重启个人Chrome，不清锁或复制profile**。不同库和连接方式的`close`语义不同；清理方法先在自建无登录环境验证，不能拿个人浏览器试。停止配套自建浏览器也会关闭窗口，用户仍在登录/操作时先协调。
- 截图留在同一会话原地完成；缺截图能力就说明缺口，不为截图重启、热改worker或再次全量采集。保存已有结果后，后续导出检查使用该记录与生产导出代码。
- 临时改变筛选/指标前记录原状态；结束逐项恢复并核对，避免批量点击被框架合并；不保存为账户默认设置。工具被撤销后不能为恢复而绕过拒绝，报告未恢复项由用户处理。

先确认宿主允许的连接方式，不绕过客户端专用浏览器策略。工具不足不能悄悄变成找下载按钮；需记录限制及可行回退。也不要把安装一个MCP本身当作目标。

本Skill随附[Playwright专用浏览器脚本](playwright-runtime.md)，在允许本地命令时可直接作为网络调查与HTTP小样本通道，不需另造连接器；Windows当前因ACL尚未验收而禁用。也可选配Google维护的Chrome DevTools MCP作为页面辅助；它能观察和操作浏览器，**不是只读沙箱，也不是通用凭据过滤器**。网页、快照、截图、控制台和网络都可能含业务或个人信息。只使用被允许交给当前模型处理的内容；公司不允许外发的数据不能靠“我会保密”越过限制。

## MCP页面辅助配置（不是完整接口采集配置）

以下仅在需要页面控制工具时选用；已有满足要求的工具可跳过。**这组命令关闭直接交给模型的原始网络详情，因此它单独不满足接口优先任务。** 采集仍需建立并验证本地过滤的观察/请求通道，不能只装好此配置就退回DOM。

先按[环境准备说明](setup.md)检测，缺依赖先解释并获得安装授权。以下是给助手执行的参考，不要求同事逐行理解。

- 需要本机Chrome和受支持的Node/npm/npx。核对版本1.9.0的官方Node要求为`^20.19.0 || ^22.12.0 || >=23`；新准备环境优先当时受支持的Node LTS，不为了满足最低版本安装已停止维护版本。
- 这里固定`chrome-devtools-mcp@1.9.0`，避免每次自动升级。升级时重新核对官方文档、参数和实际工具输出。
- 安装前检查同名配置，已有配置不能直接覆盖。下列配置默认由工具打开**独立Chrome资料目录**，不是接管个人默认浏览器。用户在这个窗口自行登录；不要复制旧Cookie/profile。

Mac/Linux客户端CLI参考：

```sh
# Codex（只选自己使用的客户端）
codex mcp add browser-to-tool-browser -- npx -y chrome-devtools-mcp@1.9.0 --category-network=false --redact-network-headers=true --category-performance=false --no-usage-statistics --no-performance-crux

# Claude Code
claude mcp add --scope user browser-to-tool-browser -- npx -y chrome-devtools-mcp@1.9.0 --category-network=false --redact-network-headers=true --category-performance=false --no-usage-statistics --no-performance-crux
```

Windows原生命令使用`cmd /c npx`，不要假定客户端能直接执行`npx.cmd`：

```powershell
codex mcp add browser-to-tool-browser -- cmd /c npx -y chrome-devtools-mcp@1.9.0 --category-network=false --redact-network-headers=true --category-performance=false --no-usage-statistics --no-performance-crux

claude mcp add --scope user browser-to-tool-browser -- cmd /c npx -y chrome-devtools-mcp@1.9.0 --category-network=false --redact-network-headers=true --category-performance=false --no-usage-statistics --no-performance-crux
```

以上均会修改客户端用户配置并在首次运行时下载包，必须先获准。若只有桌面客户端而终端没有`codex`/`claude`命令，使用该客户端提供的MCP配置入口，或按当前官方文档修改已有用户配置；不要为了配置MCP又要求重装整个客户端。保持已有条目不变；命令是`npx`（Windows为`cmd`加`/c npx`），参数就是上面的固定包名和开关。初次下载超时或Chrome发现失败时按官方排障检查PATH和启动超时，不反复重装或硬编码同事的系统路径。

配置完成后重新加载/重启客户端，用其MCP状态页检查连接；再实际列出浏览器页面并读取一个无敏感内容的测试页，确认工具可用，而不是只看到配置文件就说成功。还没被授权访问的页面，不为测试随意读取。

### 这些默认参数意味着什么

- 关闭原始网络工具及性能采集，避免直接把完整请求详情或追踪信息交给模型。
- `redact-network-headers=true`是官方“部分敏感请求头”过滤选项，不涵盖所有自定义头、URL、正文、控制台和截图，不能作为“不会泄露凭据”的保证。
- 关闭工具使用统计和CrUX查询，不代表当前模型、本身的Chrome或其他系统不联网。
- 独立浏览器的登录资料默认保存在工具私有缓存目录；它不是成果文件，不复制到桌面交付物，不打包给同事。
- 不添加`--allow-unrestricted-paths`或关闭宿主权限。确需截图/文件落盘时限定到本任务目录，并核对客户端的MCP roots/官方`--workspace`支持；不要把整个磁盘开放给工具。工具因目录限制只能写临时目录时，不把临时路径当正式成果。

### 用户要求直接用已经登录的个人Chrome

本节仅指额外配置Chrome DevTools MCP直接连接，不是Codex官方扩展的准备步骤。优先核查上面的已有扩展路线，不能要求官方扩展用户先开放远程调试端口。直接连接是可选项，不是默认，也不复用以前的授权。先说明可能暴露该浏览器中的其他标签页，建议关闭无关/敏感页面或使用专用资料目录。明确本轮目标、允许的查询和连接范围后，再依据官方说明设置`--autoConnect`：需要Chrome144+，在`chrome://inspect/#remote-debugging`启用远程调试，并由用户处理Chrome连接确认。不要擅自改个人浏览器启动方式或对外开放调试端口。

连接后仅使用授权页。借用已有页面只断开自己连接，不关闭用户标签页或退出个人Chrome；新建窗口也应先说明关闭影响，用户仍在登录/操作时不强关。离开页面、切换账户或撤销授权后，旧范围不自动延续。

## 页面用于触发与核对

1. 最小读取定位授权页、当前筛选及日期，不先遍历全页寻找导出按钮。截图/快照也可能含敏感内容。
2. 采集任务先建立网络监听，再正常查询、改变一个筛选或翻一次页，关联动作与请求/响应；错过初始请求时安全地重新查询。
3. 根据真实证据验证HTTP查询：服务端分页验证一页及下一页；本地分页、单页或零条按HTTP参考验证终点。随后编写请求代码；页面用于对比ID、字段、范围，不承担默认的批量翻页。普通界面开发按其目标使用页面工具即可。
4. 回退到官方导出/DOM需记录网络路线的实际阻塞或明确的一次性导出需求，不能看到下载按钮就宣布方案完成。记录观察时间、来源、直接观察/推断与未验证部分。

## 接口取证：在本地过滤后输出

上述MCP示例关闭的是“直接返回模型的原始详情”，不是禁止本地观察网络或发送获授权的HTTP请求。优先主动建立可用的先行过滤通道；不要只增加一个`redact-network-headers`参数就宣称全部内容安全，也不要先让模型读到Cookie再删报告。不要求用户复制HAR、请求头或控制台内容。

先复用当前会话已有合规通道；确有缺口且获准时才使用配套Playwright脚本。不适用时，由执行Skill的助手按真实且获允许的API编写最小本地观察代码，保存到`代码/`，复用授权连接；例如已有浏览器库或公开CDP网络事件。若现有工具原生提供满足数据边界的能力，复用而不重写。接口请求的认证和小样本验证按HTTP参考处理。没有安全通道时明确报告阻塞及下一步，不冒充完成，不默默降级。

配套脚本不是万能连接器；不支持的iframe、Service Worker、复杂认证等机制需要按当前环境实现并测试，不能声称已经覆盖。

观察实现应满足：

- 绑定本轮目标页/文档和授权范围，正常GET/POST查询均可被观察；不拦截或改写站点请求，不自动重放未知接口，不查看其他标签页。
- 原始内容只在本地进程内处理，不落HAR、原始日志或profile副本，不输出完整异常对象、请求对象或环境变量。关闭库的调试日志。
- 请求头永不输出；本地受信任客户端可在授权内使用必要认证，但不把值交给模型。请求体先输出结构，已确认无秘密的分页/日期/筛选值可作为白名单证据。URL删除用户名、密码、查询凭据、片段及敏感路径段；无法判断路径是否安全时只给本地编号和安全摘要。
- 响应先给字段结构、类型、记录数和分页结构；只在确认业务授权与字段含义后输出白名单业务样例。Cookie、Authorization、令牌、密码、签名、下载密钥及未知长串不进入输出；拿不准就省略，不靠单个黑名单正则宣称全覆盖。
- 对正文大小、时间、数量设置合理上限；二进制、非JSON、解析失败、跳转登录、截断或未知格式只输出安全状态，不兜底打印原文。大整数ID不能被浮点数悄悄截断。
- 用含伪造凭据、敏感URL、嵌套字段、失败和截断的合成响应验证过滤先于stdout/模型返回，再用于授权页面。过滤是这段具体代码的责任，不能用本Skill文字当安全证据。
- 停止或撤销授权即结束观察并释放自己的连接；不关闭借用页面。必要的业务样例最小化保存在本任务目录，写清获取范围。

## 官方依据

- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [1.9.0发布提交的配置说明](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/1cec9cd1a3bbf1895c98fa4b4e0e2da5a36e4075/docs/configuration.md)
- [同版本客户端配置](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/1cec9cd1a3bbf1895c98fa4b4e0e2da5a36e4075/docs/client-configurations.md)
- [Codex MCP](https://developers.openai.com/codex/mcp/)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [OpenAI内置浏览器与Developer mode](https://developers.openai.com/codex/app/browser)、[官方浏览器扩展](https://developers.openai.com/codex/app/chrome-extension)、[组织管理限制](https://developers.openai.com/codex/enterprise/managed-configuration)
- [Chrome debugger传输、Network与detach](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Playwright Browser.close生命周期](https://playwright.dev/docs/api/class-browser#browser-close)

MCP固定版本配置在2026-09-15核对；OpenAI浏览器/Chrome debugger/Playwright关闭语义在2026-09-17核对。官方能力说明不是当前安装版本或实站验收；以实际工具及授权为准。
