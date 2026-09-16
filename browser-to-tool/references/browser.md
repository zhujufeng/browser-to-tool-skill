# 浏览器调查说明

## 按任务能力选择工具，不默认走页面采集

检查实际工具、版本和连接方式。采集/导出任务先按[HTTP采集路线](http-collection.md)验证网络观察、先行过滤和请求执行能力；仅能截图/点击的浏览器不是完整采集通道。Codex内置浏览器满足要求就复用，不凭名称推断支持或禁用它；不足时检查获允许的本地脚本通道或协助准备必要工具。

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

这是可选项，不是默认，也不复用以前的授权。先说明可能暴露该浏览器中的其他标签页，建议关闭无关/敏感页面或使用专用资料目录。明确本轮目标、允许的查询和连接范围后，再依据官方说明设置`--autoConnect`：需要Chrome144+，在`chrome://inspect/#remote-debugging`启用远程调试，并由用户处理Chrome连接确认。不要擅自改个人浏览器启动方式或对外开放调试端口。

连接后仅使用授权页。借用已有页面只断开自己连接，不关闭用户标签页或退出个人Chrome；新建窗口也应先说明关闭影响，用户仍在登录/操作时不强关。离开页面、切换账户或撤销授权后，旧范围不自动延续。

## 页面用于触发与核对

1. 最小读取定位授权页、当前筛选及日期，不先遍历全页寻找导出按钮。截图/快照也可能含敏感内容。
2. 采集任务先建立网络监听，再正常查询、改变一个筛选或翻一次页，关联动作与请求/响应；错过初始请求时安全地重新查询。
3. 根据真实证据验证一页HTTP查询及下一页，随后编写请求代码；页面用于对比ID、字段、范围，不承担默认的批量翻页。普通界面开发按其目标使用页面工具即可。
4. 回退到官方导出/DOM需记录网络路线的实际阻塞或明确的一次性导出需求，不能看到下载按钮就宣布方案完成。记录观察时间、来源、直接观察/推断与未验证部分。

## 接口取证：在本地过滤后输出

上述MCP示例关闭的是“直接返回模型的原始详情”，不是禁止本地观察网络或发送获授权的HTTP请求。优先主动建立可用的先行过滤通道；不要只增加一个`redact-network-headers`参数就宣称全部内容安全，也不要先让模型读到Cookie再删报告。不要求用户复制HAR、请求头或控制台内容。

先复用配套Playwright脚本或已有合规通道。不适用时，由执行Skill的助手按真实且获允许的API编写最小本地观察代码，保存到`代码/`，复用授权连接；例如已有浏览器库或公开CDP网络事件。若现有工具原生提供满足数据边界的能力，复用而不重写。接口请求的认证和小样本验证按HTTP参考处理。没有安全通道时明确报告阻塞及下一步，不冒充完成，不默默降级。

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

配置依据在2026-09-15核对；客户端和工具更新后，以其当前官方说明及实际能力为准。
