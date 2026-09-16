#!/usr/bin/env python3
"""维护者自检：只操作临时桌面，不访问真实后台。普通使用者不需要Python。"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / 'browser-to-tool'
PASSED = []


def check(label, condition):
    assert condition, label
    PASSED.append(label)


def digest_tree(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


def main():
    text = (SKILL / 'SKILL.md').read_text(encoding='utf-8')
    parts = text.split('---', 2)
    check('标准Frontmatter存在', len(parts) == 3 and not parts[0].strip())
    fields = dict(line.split(': ', 1) for line in parts[1].strip().splitlines())
    check('只使用共享字段', set(fields) == {'name', 'description', 'compatibility'})
    check('名称匹配目录', fields['name'] == SKILL.name and bool(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', fields['name'])))
    check('字段及正文长度', len(fields['name']) <= 64 and 0 < len(fields['description']) <= 1024 and 0 < len(fields['compatibility']) <= 500 and len(text.splitlines()) < 500)
    for file in SKILL.rglob('*.md'):
        for target in re.findall(r'\]\(([^)]+)\)', file.read_text(encoding='utf-8')):
            if '://' not in target and not target.startswith('#'):
                check(f'相对引用：{file.name} → {target}', (file.parent / target.split('#')[0]).is_file())
    # 策略文本回归，不是模型执行结果；真实行为要按evals.json复测。
    http = (SKILL / 'references/http-collection.md').read_text(encoding='utf-8')
    browser = (SKILL / 'references/browser.md').read_text(encoding='utf-8')
    cases = json.loads((ROOT / '维护者/evals.json').read_text(encoding='utf-8'))
    check('策略文本：接口先于页面回退', '监听真实接口 → 小样本HTTP验证 → 编写分页请求代码' in text)
    check('策略文本：移除旧页面足够即结束规则', '页面证据足够就开始实现' not in browser)
    check('策略文本：不能把页面MCP当网络能力', '不是完整接口采集配置' in browser and '它单独不满足接口优先任务' in browser)
    check('策略文本：认证与浏览器依赖说明', '受信任的本地客户端可以管理会话' in http and '运行时仍需要浏览器' in http and '重定向' in http)
    check('策略文本：小样本和失败边界', all(word in http for word in ('下一页', '429', '401/403', '默认串行', '部分结果')))
    check('待运行场景完整且不冒充已通过', {c['id'] for c in cases['evals']} == {1, 2, 3, 4, 5} and '尚无模型通过结果' in cases['status'])
    clients = (SKILL / 'references/clients.md').read_text(encoding='utf-8')
    check('策略文本：不绑定单一宿主', all(name in fields['compatibility'] for name in ('Codex', 'Claude Code', 'Pi', 'OpenCode')) and '不绑定Codex或任何内置浏览器' in text)
    check('适配文本：四种目录与Pi能力边界', all(path in clients for path in ('~/.agents/skills/', '~/.claude/skills/', '~/.pi/agent/skills/', '~/.config/opencode/skills/')) and '没有原生MCP客户端或内置浏览器' in clients)
    shell = SKILL / 'scripts/workspace.sh'
    ps = SKILL / 'scripts/workspace.ps1'
    check('Windows脚本UTF-8 BOM兼容PowerShell5.1', ps.read_bytes().startswith(b'\xef\xbb\xbf'))
    check('没有要求Node/Python/Git才能创建目录', not re.search(r'(?m)^\s*(?:node|python3?|git|npm|npx)\s', shell.read_text(encoding='utf-8')))

    with tempfile.TemporaryDirectory(prefix='browser-to-tool-check-') as temp:
        root = Path(temp)
        desktop = root / 'OneDrive 桌面 [测试]'
        desktop.mkdir()
        desktop = desktop.resolve()  # macOS的/var可指向/private/var；脚本返回真实路径。
        cwd = root / '无关工作目录'
        cwd.mkdir()
        env = os.environ.copy()
        if os.name == 'nt':
            runner = ['powershell.exe', '-NoProfile', '-File', str(ps)]
            opts = {'name': '-Name', 'desktop': '-Desktop', 'resume': '-Resume'}
        else:
            subprocess.run(['/bin/sh', '-n', str(shell)], check=True)
            # PATH只提供系统命令：确认没有Node/Python/Git也能实际创建目录。
            bin_dir = root / '系统命令'
            bin_dir.mkdir()
            for name in ('tr', 'sed', 'wc', 'date', 'mkdir', 'uname', 'grep', 'osascript', 'xdg-user-dir'):
                found = shutil.which(name)
                if found:
                    (bin_dir / name).symlink_to(found)
            env['PATH'] = str(bin_dir)
            runner = ['/bin/sh', str(shell)]
            opts = {'name': '--name', 'desktop': '--desktop', 'resume': '--resume'}

        def run(ok=True, **args):
            cmd = runner + [value for key, val in args.items() for value in (opts[key], str(val))]
            result = subprocess.run(cmd, cwd=cwd, env=env, text=True, encoding='utf-8', capture_output=True, timeout=15)
            assert (result.returncode == 0) == ok, (cmd, result.returncode, result.stdout, result.stderr)
            return result

        first = Path(run(desktop=desktop, name='商品导出工具').stdout.strip())
        check('中文及空格路径', first.parent == desktop and first.is_dir())
        check('最小目录不造空输出', {p.name for p in first.iterdir()} == {'工作记录.md', '使用说明.md', '代码'})
        check('初始化不谎报完成', '尚未执行' in (first / '工作记录.md').read_text(encoding='utf-8'))
        check('明确使用说明状态', '工具尚未完成' in (first / '使用说明.md').read_text(encoding='utf-8'))
        (first / '代码/已有代码.txt').write_text('不可覆盖：合成数据', encoding='utf-8')
        before = digest_tree(first)
        second = Path(run(desktop=desktop, name='商品导出工具').stdout.strip())
        check('同名追加序号', second.name == first.name + '_2' and digest_tree(first) == before)
        result = run(resume=first)
        check('续作原目录且字节不变', Path(result.stdout.strip()) == first and digest_tree(first) == before)
        run(ok=False, resume=first, name='不应新建')
        run(ok=False, resume=root / '不存在')
        run(ok=False, resume='相对路径')
        run(ok=False, desktop=root / '不存在', name='测试')
        run(ok=False, desktop='relative', name='测试')
        run(ok=False, desktop=desktop, name=' .. ')
        run(ok=False, desktop=desktop, name='长' * 50)
        check('无效输入不创建假桌面', not (root / '不存在').exists())
        escaped = Path(run(desktop=desktop, name='../../不越界:测试?').stdout.strip())
        check('任务名不能路径穿越', escaped.parent == desktop and ':' not in escaped.name and '?' not in escaped.name)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            paths = list(pool.map(lambda _: run(desktop=desktop, name='并发不覆盖').stdout.strip(), range(4)))
        check('并发创建不覆盖', len(set(paths)) == 4 and all(Path(p).is_dir() for p in paths))
        check('没有散落到当前工作目录', not list(cwd.iterdir()))
        if os.name != 'nt':
            check('本机新目录仅用户可访问', first.stat().st_mode & 0o777 == 0o700)
            check('本机记录权限', (first / '工作记录.md').stat().st_mode & 0o777 == 0o600)
            link = root / '续作链接'
            link.symlink_to(first, target_is_directory=True)
            run(ok=False, resume=link)
            (first / '使用说明.md').unlink()
            (first / '使用说明.md').symlink_to(second / '使用说明.md')
            run(ok=False, resume=first)
            check('拒绝符号链接续作', True)
            blocked = root / '只读桌面'
            blocked.mkdir(mode=0o500)
            try:
                run(ok=False, desktop=blocked, name='权限测试')
                check('无权限不换位置', not list(blocked.iterdir()))
            finally:
                blocked.chmod(0o700)
    print('\n'.join('PASS ' + label for label in PASSED))
    print(f'PASS 共{len(PASSED)}项；平台={sys.platform}。临时目录已清理。')
    print('未覆盖：另一操作系统真实运行、各客户端模型调用、真实网站和敏感业务；静态检查不证明模型行为。')


if __name__ == '__main__':
    main()
