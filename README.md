# Browser to Tool · 看网页，做工具

给非开发同事使用的**接口优先 Skill**。适用于 Codex、Claude Code、Pi、OpenCode，以及兼容 Agent Skills 的编码助手。

你提供网站和需求，助手检查环境，优先监听真实数据接口、验证 HTTP 请求，再开发分页采集或自动化工具。浏览器主要负责登录、触发查询和核对结果，不默认寻找下载按钮或逐页抄页面。

**不绑定 Codex 自带浏览器。** Skill 是工作方法，不自带浏览器、MCP 服务或登录态；按当前 Agent 的实际网络监听、过滤和 HTTP 能力选择工具。

## 最简单的安装方式

把这段话发给你正在使用的编码助手：

> 请从 https://github.com/zhujufeng/browser-to-tool-skill 安装 browser-to-tool Skill。先读取 README 和 Skill 内容，只将完整的 browser-to-tool 文件夹安装到当前客户端的个人技能目录；已有同名版本先询问并备份。不要重装客户端、修改其他配置或自动安装浏览器依赖。没有 Git 时可以下载 ZIP。完成后告诉我如何调用。

也可点击 GitHub 的 **Code → Download ZIP**，解压后将完整`browser-to-tool/`文件夹复制到下表目录。不要只复制 SKILL.md；也不要把整个仓库当成 Skill 文件夹。

| 客户端 | 推荐个人安装目录 | 调用 |
|---|---|---|
| Codex | `~/.agents/skills/browser-to-tool/` | `$browser-to-tool` 或 `/skills` |
| Claude Code | `~/.claude/skills/browser-to-tool/` | `/browser-to-tool` |
| Pi | `~/.pi/agent/skills/browser-to-tool/` | `/skill:browser-to-tool`，安装后 `/reload` |
| OpenCode | `~/.config/opencode/skills/browser-to-tool/` | 告诉助手“请加载 browser-to-tool Skill” |

`~`代表当前用户主目录。Pi、OpenCode也可发现共享的`~/.agents/skills/`，已有副本时不重复安装。安装/更新后建议新开对话，避免沿用旧指令。OpenCode等客户端的技能权限或项目规则仍然生效。

**不需要为了安装 Skill 先装 Node、Python 或 Git。** 当前客户端需要有下载/文件操作能力；工具依赖按具体任务检测，确实需要安装时先说明并征求同意。

## 怎么用

```text
请使用 browser-to-tool，帮我为这个后台做一个商品采集工具：<URL>。
优先监听页面查询的数据接口，然后开发 HTTP 分页采集代码。
先检查当前工具能力，需要登录时告诉我。
先验证一页和下一页，再处理当前筛选范围的全部数据。
调查记录、代码和结果都放到桌面一个新文件夹。
```

不需要你找选择器、复制接口或操作开发者控制台。继续修改时说：

> 继续桌面的“日期_商品采集工具”任务，增加日期筛选，不另建文件夹。

每个新需求默认保存为：

```text
桌面/日期_任务名/
├── 工作记录.md    调查依据、分析、进度和验证结果
├── 使用说明.md    首次准备、日常运行、失败和停止方式
├── 代码/
└── 输出/          有实际结果时才创建
```

同名不覆盖，续作沿用旧目录。桌面脚本只用系统 Shell / PowerShell，不要求开发运行时；桌面不可用或无权限时明确说明，不偷偷换位置。桌面本来由 OneDrive/iCloud 同步时，敏感任务应先确认是否改放本地目录。

## 换一个 Agent，浏览器怎么办？

| 当前环境 | 处理方式 |
|---|---|
| 已有安全网络监听和 HTTP 工具 | 直接复用，不强制更换浏览器 |
| 只有截图、点击工具 | 先检查宿主允许的本地观察/HTTP通道；缺依赖再协助准备，不默认退回下载按钮 |
| Codex / Claude Code / OpenCode 需要 MCP | 按各自配置方式接入，不能互抄配置格式 |
| Pi | 核心没有原生 MCP 或内置浏览器；复用已安装且获信任的扩展/CLI，或使用允许的本地脚本；不假造`pi mcp add`命令 |
| 宿主或公司禁止额外通道/安装 | 遵守限制，解释阻塞及回退方案，不绕过权限 |

详细步骤在 [客户端适配](browser-to-tool/references/clients.md)、[环境准备](browser-to-tool/references/setup.md)、[浏览器说明](browser-to-tool/references/browser.md)和 [HTTP采集路线](browser-to-tool/references/http-collection.md)。

浏览器参考里的 Chrome DevTools MCP 配置**只是页面辅助**，关闭直接返回模型的原始网络详情，单独不能完成接口采集。执行任务的助手仍需复用安全网络工具，或按当前环境实现、验证本地观察及 HTTP 代码。本仓库没有“任何网站一键监听器”。

## 数据和权限

- 用户自行登录，明确目标网站、账户和范围；不自动接管个人所有标签页。
- 受信任本地客户端可在授权内正常使用认证，但 Cookie、令牌、签名不能进入聊天、源码、日志或分享包。不复制个人 profile，不破解登录或访问控制。
- 先本地过滤网络内容，再输出必要证据。Skill 不是运行时沙箱，提示词不等于工具层安全保证。
- HTTP 一页和下一页验证通过后才处理全量；失败、限流、登录过期、部分结果必须明确。浏览器 fetch 不能冒充无需浏览器的独立客户端。
- 接口路线不可行时才评估官方导出/DOM并说明原因；明确的一次性官方导出需求不强迫造工具。
- 真正的业务写入、对外发送、安装插件、启用定时、部署发布需要相应授权。

## 当前验证状态

共享格式、文档引用及 macOS 桌面脚本已有本地检查。**四种客户端的完整模型行为、Windows/Linux实机与真实网站采集尚未全部验收**，不能因为能安装就说已能自动采集。

维护者可运行：

```sh
python3 维护者/check.py
```

Python仅供维护者自检，不是同事安装或建目录的依赖。检查只用临时桌面和合成文件，结果包含策略文本回归，不代表模型真的执行了HTTP采集。`维护者/evals.json`是待实测场景，不是通过报告。

仓库只包含 Skill、说明和检查，不包含账户、真实业务数据、个人会话、浏览器登录资料或原 Agent 应用。
