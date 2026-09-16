import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { callBrowser, readSession, recoverBrowser } from '../browser-to-tool/scripts/browser.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../browser-to-tool/scripts/browser.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(args) {
  const { stdout, stderr } = await execute(process.execPath, [cli, ...args], { env: process.env, timeout: 45000, maxBuffer: 1024 * 1024 });
  assert.equal(stderr, ''); return JSON.parse(stdout);
}
async function gone(profile) {
  for (let n = 0; n < 60; n++) { try { readSession(profile); } catch (error) { if (error.code === 'NOT_RUNNING') return; throw error; } await sleep(50); }
  assert.fail('worker未清理会话元数据');
}

test('跨命令worker：启动/监听/HTTP/文件/IPC边界/停止/重启/空闲退出', { timeout: 90000, skip: process.platform === 'win32' }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'browser-to-tool-cli-'));
  const previousHome = process.env.BROWSER_TO_TOOL_HOME;
  const state = join(temp, '私有运行目录'), workspace = join(temp, '桌面任务');
  process.env.BROWSER_TO_TOOL_HOME = state;
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(join(workspace, '代码'));
  writeFileSync(join(workspace, '工作记录.md'), '# 工作记录\n');
  let calls = 0, active, rotateCookie = false;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      calls++; res.setHeader('Content-Type', 'application/json');
      if (rotateCookie) res.setHeader('Set-Cookie', 'sid=new8abxy; Path=/; HttpOnly');
      res.end(JSON.stringify({ token: 'alpha8xy', password: '123456', items: [{ name: '合成商品', id: 7, alpha8xy: 'x', number: 123456, note: rotateCookie ? 'new8abxy' : 'plain' }], total: 1 }));
    }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><h1>CLI隔离测试</h1><script>fetch("/api?page=1")</script>'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const args = ['start', '--workspace', workspace, '--url', origin, '--profile', 'test', '--headless'];
  try {
    const diagnostic = await run(['doctor']); assert.equal(diagnostic.ready, true);
    active = await run(args); assert(active.ok); assert.equal(active.profile, 'test');
    const { session } = active;
    const metadata = readSession('test');
    assert(!JSON.stringify(active).includes(metadata.token));
    assert(!existsSync(join(workspace, 'session.json')));
    const status = await run(['status', '--profile', 'test', '--session', session]); assert.equal(status.closed, false);
    await assert.rejects(run(args), error => JSON.parse(error.stdout).error === 'PROFILE_IN_USE');
    assert.equal(readSession('test').session, session);
    assert.throws(() => recoverBrowser({ profile: 'test', confirmedStopped: true }), /WORKER_STILL_RUNNING/);
    await assert.rejects(callBrowser({ profile: 'test', session: randomUUID(), command: { action: 'status' } }), /STALE_SESSION/);
    const denied = await fetch(`http://127.0.0.1:${metadata.port}/`, { method: 'POST', headers: { authorization: `Bearer ${metadata.token}`, origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ session, command: { action: 'status' } }) });
    assert.equal((await denied.json()).error, 'ACCESS_DENIED');
    const noAuth = await fetch(`http://127.0.0.1:${metadata.port}/`); assert.equal((await noAuth.json()).error, 'ACCESS_DENIED');
    await run(['call', '--profile', 'test', '--session', session, '--json', '{"action":"observe"}']);
    let item;
    for (let n = 0; n < 30 && !item; n++) item = (await callBrowser({ profile: 'test', session, command: { action: 'candidates', waitMs: 100 } })).items[0];
    assert(item); assert(!JSON.stringify(item).includes('alpha8xy'));
    const command = { action: 'query', candidate: item.id, confirmedQuery: true, patch: { query: { page: 2 } }, projection: { allowData: true, arrayPath: '/items', fields: ['id', 'name', 'number', 'note'] } };
    const reply = await run(['call', '--profile', 'test', '--session', session, '--json', JSON.stringify(command), '--out', '样本.json']);
    assert.equal(reply.preview.rows[0].name, '合成商品');
    const saved = JSON.parse(readFileSync(join(workspace, '输出', '样本.json')));
    assert.equal(saved.preview.rows[0].id, 7);
    assert(!JSON.stringify(saved).includes('123456')); assert(!JSON.stringify(saved).includes('alpha8xy'));
    const before = calls;
    await assert.rejects(callBrowser({ profile: 'test', session, command, output: '样本.json' }), /OUTPUT_EXISTS/);
    await assert.rejects(callBrowser({ profile: 'test', session, command, output: '../escape.json' }), /INVALID_OUTPUT_NAME/);
    assert.equal(calls, before);
    const outside = join(temp, '非任务目录'); mkdirSync(outside);
    renameSync(join(workspace, '输出'), join(temp, '原输出'));
    symlinkSync(outside, join(workspace, '输出'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(callBrowser({ profile: 'test', session, command, output: '禁止.json' }), /UNSAFE_OUTPUT_DIRECTORY/);
    assert.deepEqual(readdirSync(outside), []);
    unlinkSync(join(workspace, '输出')); renameSync(join(temp, '原输出'), join(workspace, '输出'));
    const log = readFileSync(join(workspace, '浏览器记录.jsonl'), 'utf8');
    assert(!log.includes(metadata.token)); assert(log.includes('OUTPUT_EXISTS'));
    rotateCookie = true;
    const rotated = await callBrowser({ profile: 'test', session, command, output: '轮换Cookie样本.json' });
    assert.equal(rotated.preview.rows[0].note, '[redacted]');
    assert(!readFileSync(join(workspace, '输出/轮换Cookie样本.json'), 'utf8').includes('new8abxy'));
    rotateCookie = false;
    const stopped = await run(['stop', '--profile', 'test', '--session', session]); assert(stopped.stopped);
    await gone('test'); active = undefined;
    assert(existsSync(join(state, 'profiles/test/browser')), '停止不删除登录资料');
    active = await run([...args, '--idle-minutes', String(1 / 30)]);
    assert.notEqual(active.session, session);
    await gone('test'); active = undefined;
    assert(readFileSync(join(workspace, '浏览器记录.jsonl'), 'utf8').includes('idle-stop'));
    active = await run([...args, '--idle-minutes', String(1 / 30)]);
    renameSync(workspace, join(temp, '移动的任务'));
    await gone('test'); active = undefined;
    renameSync(join(temp, '移动的任务'), workspace);
    active = await run([...args, '--idle-minutes', String(1 / 30)]);
    renameSync(join(workspace, '浏览器记录.jsonl'), join(workspace, '原记录.jsonl'));
    mkdirSync(join(workspace, '浏览器记录.jsonl'));
    await gone('test'); active = undefined;
    rmSync(join(workspace, '浏览器记录.jsonl'), { recursive: true });
    renameSync(join(workspace, '原记录.jsonl'), join(workspace, '浏览器记录.jsonl'));

    const stale = join(state, 'profiles', 'stale'); mkdirSync(join(stale, 'browser'), { recursive: true, mode: 0o700 });
    writeFileSync(join(stale, 'browser', 'preserve.txt'), '合成登录资料');
    writeFileSync(join(stale, 'session.json'), JSON.stringify({ pid: 2147483647, port: 1, token: randomBytes(32).toString('hex'), session: randomUUID() }), { mode: 0o600 });
    assert.throws(() => recoverBrowser({ profile: 'stale' }), /STOP_CONFIRMATION_REQUIRED/);
    assert(recoverBrowser({ profile: 'stale', confirmedStopped: true }).profileRetained);
    assert.equal(readFileSync(join(stale, 'browser/preserve.txt'), 'utf8'), '合成登录资料');
  } finally {
    if (active) { await callBrowser({ profile: 'test', session: active.session, command: { action: 'stop' } }).catch(() => {}); await gone('test'); }
    await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.BROWSER_TO_TOOL_HOME; else process.env.BROWSER_TO_TOOL_HOME = previousHome;
    rmSync(temp, { recursive: true, force: true });
  }
});
