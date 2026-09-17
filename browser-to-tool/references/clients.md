# 客户端适配：同一个Skill，不同的工具接入

本Skill采用共享的Agent Skills格式，既不依赖Codex内置浏览器，也不要求把所有客户端都装成同一种环境。**Skill负责工作方法；浏览器、网络和命令工具由当前宿主提供。** 能加载Skill不等于已经能监听接口。

## 安装及调用

把完整`browser-to-tool/`文件夹（含scripts/references）放入当前客户端的技能目录，不仅复制SKILL.md。已有同名版本先比较、备份并征求替换确认；避免在多个发现目录重复安装。同事无Git时可让助手下载GitHub ZIP再复制，不必为安装Skill先装Git或Node。

| 客户端 | 推荐个人目录 | 调用 |
|---|---|---|
| Codex | `~/.agents/skills/browser-to-tool/` | `$browser-to-tool`，或`/skills`中选择 |
| Claude Code | `~/.claude/skills/browser-to-tool/` | `/browser-to-tool` |
| Pi | `~/.pi/agent/skills/browser-to-tool/` | `/skill:browser-to-tool`；安装后`/reload`，测试新行为建议新会话 |
| OpenCode | `~/.config/opencode/skills/browser-to-tool/` | 说“请加载browser-to-tool Skill并执行下面任务”；由原生`skill`工具加载，不假造同名斜杠命令 |

`~`指当前使用者主目录，不是桌面。Pi和OpenCode也可发现共享的`~/.agents/skills/`；已有共享副本时不再复制一份。若客户端配置或环境变量改变了默认目录，以真实配置为准，不覆盖用户设置。OpenCode的skill权限若为deny或被关闭，先说明权限阻塞，不改成全局allow。

项目级目录分别为`.agents/skills/`（Codex）、`.claude/skills/`、`.pi/skills/`、`.opencode/skills/`。项目信任/权限照常生效。个人安装不依赖新建Git仓库；业务成果仍默认放桌面独立任务文件夹。

## 先识别客户端、运行形态和真实工具

先依据当前宿主说明、实际工具列表和必要的版本/连接状态，在工作记录写一行：`客户端 / 桌面、终端、IDE或远程 / 工具与连接状态 / 执行位置 / 已授权范围`。不从模型名称、Skill安装目录或机器装有某个App推断浏览器能力；也不读取整份个人配置。无法识别时标为未知，只有影响接入选择才问用户一个简短问题。

| 当前环境 | 先检查什么 | 不应假定什么 |
|---|---|---|
| Codex桌面 | 实际暴露的官方扩展、内置浏览器与批准状态；按用途选用 | 所有版本/工作区都已开放，或桌面App存在就能被当前会话调用 |
| Codex终端 / IDE | 当前会话已有的MCP或其他浏览器集成；无合适通道才考虑获准的本地运行器 | 自动共享Codex桌面的内置浏览器、扩展或登录态 |
| Claude Code终端 / IDE | 当前会话已有的浏览器集成/MCP及其文档；否则考虑获准的Playwright | 自带内置浏览器，或能调用Codex的扩展/Developer mode |
| Pi | 已加载的可信浏览器扩展/CLI；否则检查本地运行器 | 核心自带浏览器或MCP客户端 |
| OpenCode | 当前会话MCP/插件的实际工具与连接 | 自带Codex式内置浏览器或共享其配置 |
| 其他桌面产品或未知宿主 | 只按当前明确提供的工具核实 | 同品牌产品之间的能力自动通用 |
| SSH / 容器 / WSL / 云端 | 工具实际运行在哪台机器、授权浏览器连接及输出映射 | localhost指向用户电脑，或能控制本机已登录Chrome |

远程形态是叠加条件：先确定客户端，再确认执行位置。终端中已有明确安装、连接且获准的浏览器集成可以复用；不把“默认没有”写成“永远不支持”。只加载适用分支，不让Claude Code/Pi用户寻找Codex设置。

## 按能力选择浏览器及网络通道

1. 完成上表识别，再列出页面导航、网络事件/响应、执行本地代码、HTTP请求与本地过滤能力，不猜工具名。
2. **已有安全网络能力：直接复用。** 按[用途与会话优先级](browser.md)选择；已登录后台优先现有会话，本地预览仅在当前会话确有内置浏览器时优先使用，否则选已有合适工具；独立Playwright用于缺口或隔离测试。续作不因“另一个排名更高”强制迁移。
3. **只有页面工具：检查允许的本地脚本/已有浏览器库。** 需要依赖或连接授权时再协助准备，先监听再触发查询，敏感内容先本地过滤后输出。
4. **没有浏览器工具：** 按宿主支持的方式准备，不把普通web fetch当作接管浏览器。HTTP公开接口可直接访问时也不必为了流程而启动浏览器。
5. **宿主禁止额外通道：** 遵守限制，报告缺失能力/回退选择；Skill不能提高权限或绕过专用浏览器策略。

### Codex桌面（仅当前会话实际提供该工具时）

Codex桌面的官方Chrome扩展可使用已有登录态；官方Developer mode支持Chrome与内置浏览器的网络检查，但完整CDP需批准，组织可禁用。先读当前工具文档并核实先行过滤能力，不把“没有调试端口”当作扩展不支持的证据。Codex CLI或Claude Code不自动具有这套桌面工具，不能猜同名API。

### Codex终端 / Claude Code终端及IDE

不走上一节的桌面设置流程。先核查当前会话已配置的MCP或浏览器集成，读其实际API与授权要求；没有就直接说明缺少通道，在允许本地执行时考虑配套Playwright，不要求用户先安装桌面App或不存在的“内置浏览器”。已有工具够用不另搭MCP。

确认缺口且获准换通道时，才按实际客户端的MCP入口配置。浏览器参考中提供二者的Chrome DevTools MCP页面辅助示例；该示例**不单独完成网络取证**。不能假定安装Skill就自动注册MCP，也不能直接复用其他客户端的配置文件。

### OpenCode

原生支持MCP，在其配置的`mcp`下添加条目；不是Claude的`mcpServers`，也不是Codex的TOML。以下仅为可选**页面辅助配置**，并不单独满足接口监听，需要时获准后合并到现有配置，保留其他设置：

```json
{
  "mcp": {
    "browser-to-tool-browser": {
      "type": "local",
      "command": ["npx", "-y", "chrome-devtools-mcp@1.9.0", "--category-network=false", "--redact-network-headers=true", "--category-performance=false", "--no-usage-statistics", "--no-performance-crux"],
      "enabled": true
    }
  }
}
```

Windows原生启动npx时，根据环境将命令前缀改为`["cmd", "/c", "npx", ...]`；不要改执行策略或盲目扩大权限。先核对运行时、MCP实际连接及可用工具，再按HTTP参考补齐安全网络能力。当前Agent如果是受限/只读模式，不能为了运行代码自行切换权限。

### Pi

Pi核心默认提供文件和命令工具，**没有原生MCP客户端或内置浏览器**。不能生成`pi mcp add`之类不存在的命令，也不能把Claude/OpenCode的MCP配置直接写进Pi设置。

- 已有获信任的浏览器/网络扩展或CLI：先核对真实接口与权限后复用。
- 只有文件/命令工具：可由助手在获授权范围使用现有运行时/浏览器库实现本地观察和HTTP代码；需要新增依赖才准备，不为了Skill自动安装一套扩展系统。
- 若选择第三方MCP桥接扩展，应先确认具体扩展的文档、维护状态和安装授权；本仓库不附带、不自动安装，也不保证任意桥接扩展兼容。
- Pi安装包与项目扩展可能拥有很广的系统访问能力；Skill中的业务确认规则不是运行时沙箱。读懂第三方代码再安装，不能声称Pi自带所有权限弹窗。

## 首次验证

先验证能发现/加载Skill，再检查实际工具及授权连接，最后用合成或允许的小范围网站完成“先监听→触发查询→HTTP验证分页/终点→获准落盘”。服务端分页验证下一页；本地分页、单页或零条按HTTP参考验证终点，不猜分页参数。分别记录每一层是否成功，不能把配置或格式兼容当成采集已成功。本文的四种安装方式有官方依据，真实模型效果及具体网络通道仍需本机验证。

## 官方依据

- [Agent Skills标准](https://agentskills.io/specification)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Pi Skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)及[Pi核心能力](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [OpenCode Skills](https://opencode.ai/docs/skills/)、[OpenCode MCP](https://opencode.ai/docs/mcp-servers/)

2026-09-16核对；客户端版本和配置变化时以实际文档和能力为准。
