import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowserSession } from '../browser-to-tool/scripts/browser-session.mjs';
import { readSession, startBrowser, callBrowser } from '../browser-to-tool/scripts/browser.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function candidate(browser) {
  for (let i = 0; i < 40; i++) { const items = (await browser.execute({ action: 'candidates', waitMs: 100 })).items; if (items.length) return items[0]; }
  assert.fail('no candidate');
}

test('安全回归：多操作GraphQL mutation及同文档Bearer账户切换', { timeout: 45000, skip: process.platform === 'win32' }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'browser-to-tool-auth-'));
  let calls = 0, browser;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* 只消费合成请求，不执行业务写入。 */ }
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><h1>授权边界合成测试</h1>'); }
    else { calls++; res.setHeader('Content-Type', 'application/json'); res.end('{"items":[{"id":1}]}'); }
  });
  const origin = await listen(server);
  try {
    browser = await openBrowserSession({ profileDir: join(temp, 'profile'), url: origin, headless: true });
    await browser.execute({ action: 'observe', reload: false });
    await browser.page.evaluate(async () => { await fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName: 'M', query: 'query Q { viewer { id } } mutation M { changeSetting }' }) }); });
    let item = await candidate(browser), before = calls;
    await assert.rejects(browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true }), /GRAPHQL_QUERY_REQUIRED/);
    assert.equal(calls, before);
    await browser.execute({ action: 'observe', reload: false });
    await browser.page.evaluate(async () => { await fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName: 'Q', query: 'query Q { viewer { id } }' }) }); });
    item = await candidate(browser);
    assert.equal((await browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true })).status, 200);
    for (const [accountA, accountB] of [['account-a-canary', 'account-b-canary'], ['A'.repeat(4097), 'B'.repeat(4097)]]) {
      await browser.execute({ action: 'observe', reload: false });
      assert.equal((await browser.context.cookies()).length, 0);
      await browser.page.evaluate(async token => { await fetch('/items', { headers: { authorization: 'Bearer ' + token } }); }, accountA);
      item = await candidate(browser);
      await browser.page.evaluate(async token => { await fetch('/items', { headers: { authorization: 'Bearer ' + token } }); }, accountB);
      for (let i = 0; i < 40 && browser.status().watching; i++) await sleep(50);
      assert.equal(browser.status().watching, false);
      before = calls;
      await assert.rejects(browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true }), /CANDIDATE_NOT_FOUND/);
      assert.equal(calls, before);
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(temp, { recursive: true, force: true }); }
});

test('安全回归：启动父进程退出后，不留worker和占用的profile', { timeout: 45000, skip: process.platform === 'win32' }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'browser-to-tool-cancel-'));
  const workspace = join(temp, '任务'), state = join(temp, 'private');
  mkdirSync(workspace); mkdirSync(join(workspace, '代码')); writeFileSync(join(workspace, '工作记录.md'), '# 测试');
  const previous = process.env.BROWSER_TO_TOOL_HOME; process.env.BROWSER_TO_TOOL_HOME = state;
  let waiting, reached, active, child;
  const entered = new Promise(resolve => { reached = resolve; });
  const server = createServer((req, res) => { if (req.url === '/slow') { waiting = res; reached(); } else res.end('<!doctype html><p>ready</p>'); });
  const origin = await listen(server);
  try {
    const cli = fileURLToPath(new URL('../browser-to-tool/scripts/browser.mjs', import.meta.url));
    child = spawn(process.execPath, [cli, 'start', '--workspace', workspace, '--url', origin + '/slow', '--profile', 'cancel', '--headless'], { stdio: 'ignore', env: process.env });
    const exited = once(child, 'exit');
    await Promise.race([entered, exited.then(() => { throw new Error('启动过早退出'); })]);
    const worker = readSession('cancel');
    child.kill('SIGTERM'); await exited; child = undefined;
    waiting.end('<!doctype html><p>released</p>');
    const metadata = join(state, 'profiles/cancel/session.json');
    for (let i = 0; i < 100 && existsSync(metadata); i++) await sleep(50);
    assert(!existsSync(metadata));
    let dead = false;
    for (let i = 0; i < 60 && !dead; i++) { try { process.kill(worker.pid, 0); await sleep(50); } catch (error) { if (error.code === 'ESRCH') dead = true; else throw error; } }
    assert(dead, '启动被取消的worker应退出');
    active = await startBrowser({ workspace, url: origin, profile: 'cancel', headless: true });
    assert.equal(active.closed, false);
    await callBrowser({ profile: 'cancel', session: active.session, command: { action: 'stop' } }); active = undefined;
    for (let i = 0; i < 100 && existsSync(metadata); i++) await sleep(50);
    assert(!existsSync(metadata));
  } finally {
    child?.kill('SIGTERM'); waiting?.end();
    if (active) await callBrowser({ profile: 'cancel', session: active.session, command: { action: 'stop' } }).catch(() => {});
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.BROWSER_TO_TOOL_HOME; else process.env.BROWSER_TO_TOOL_HOME = previous;
    rmSync(temp, { recursive: true, force: true });
  }
});
