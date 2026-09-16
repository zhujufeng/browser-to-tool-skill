import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openBrowserSession } from '../browser-to-tool/scripts/browser-session.mjs';
import { changedRequest, parseData, projectData, rememberSecrets, dataShape, urlSummary, authenticationFingerprint } from '../browser-to-tool/scripts/browser-data.mjs';

const SESSION = 'synthetic-session-canary-0123456789';
const BEARER = 'synthetic-bearer-canary-9876543210';
const BIG = '9007199254740993123';
const headless = process.env.BROWSER_TEST_HEADED !== '1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function candidate(browser) {
  for (let i = 0; i < 40; i++) {
    const result = await browser.execute({ action: 'candidates', waitMs: 100 });
    if (result.items.length) return result.items[0];
  }
  assert.fail('未观察到合成接口');
}

test('数据投影、凭据过滤和POST数字字面值不损坏', () => {
  const secrets = new Set();
  const data = parseData(`{"token":"${SESSION}","items":[{"id":${BIG},"name":"商品","note":"${SESSION}"}]}`);
  rememberSecrets(data, secrets);
  assert.equal(data.items[0].id, BIG);
  assert(!('token' in dataShape(data)));
  const result = projectData(data, { allowData: true, arrayPath: '/items', fields: ['id', 'name', 'note'] }, secrets);
  assert.equal(result.rows[0].note, '[redacted]');
  assert(!JSON.stringify(result).includes(SESSION));
  const record = { url: 'https://example.com/api?page=1', method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"page":1,"big":${BIG},"price":0.123456789012345678901}` };
  assert.equal(changedRequest(record, { json: { page: 2 } }).body, `{"page":2,"big":${BIG},"price":0.123456789012345678901}`);
  assert.throws(() => changedRequest(record, { json: { account: 2 } }), /PATCH_FIELD_DENIED/);
  assert.throws(() => projectData(data, { allowData: true, arrayPath: '/items', fields: ['token'] }, secrets));
  assert.throws(() => projectData(data, { arrayPath: '/items', fields: ['name'] }, secrets), /DATA_APPROVAL_REQUIRED/);
  const disguised = { token: 'alpha8xy', password: '123456', items: [{ alpha8xy: 'x', note: 123456 }] };
  const known = new Set(); rememberSecrets(disguised, known);
  assert(!JSON.stringify(dataShape(disguised, known)).includes('alpha8xy'));
  assert(!JSON.stringify(urlSummary('https://example.com/?alpha8xy=1', known)).includes('alpha8xy'));
  assert.throws(() => projectData(disguised, { allowData: true, arrayPath: '/items', fields: ['alpha8xy'] }, known), /INVALID_FIELD/);
  assert.equal(projectData(disguised, { allowData: true, arrayPath: '/items', fields: ['note'] }, known).rows[0].note, '[redacted]');
  assert.notEqual(authenticationFingerprint([{ token: 'first-A' }, { token: 'same-last' }]), authenticationFingerprint([{ token: 'first-B' }, { token: 'same-last' }]));
  assert.notEqual(authenticationFingerprint(parseData('{"token":9007199254740993123}')), authenticationFingerprint(parseData('{"token":9007199254740993124}')));
});

test('真实Chromium：登录重启→监听→HTTP两页→敏感输出及失败/停止', { timeout: 90000, skip: process.platform === 'win32' }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'browser-to-tool-session-'));
  let mode = 'normal', calls = 0, foreignCalls = 0, bodyOK = false;
  const foreign = createServer((_req, res) => { foreignCalls++; res.end('must not reach'); });
  const foreignURL = await listen(foreign);
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = Buffer.concat(parts).toString();
    if (req.url === '/login') { res.setHeader('Set-Cookie', `sid=${SESSION}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`); res.end('ok'); return; }
    if (req.url === '/api/items') {
      calls++;
      bodyOK = body.includes(`"big":${BIG}`);
      if (mode === 'redirect') { res.writeHead(302, { Location: foreignURL + '/leak' }); res.end(); return; }
      if (mode === 'expired' || !req.headers.cookie?.includes(`sid=${SESSION}`)) { res.writeHead(401); res.end('login required'); return; }
      assert.equal(req.headers.authorization, `Bearer ${BEARER}`);
      if (mode === 'limit') { res.writeHead(429, { 'Retry-After': '60' }); res.end('rate limited'); return; }
      if (mode === 'html') { res.setHeader('Content-Type', 'text/html'); res.end('<html>login</html>'); return; }
      if (mode === 'slow') await sleep(350);
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'huge') { res.end(JSON.stringify({ items: ['x'.repeat(1024 * 1024 + 100)] })); return; }
      const { page = 1 } = JSON.parse(body || '{}');
      res.end(`{"token":"${SESSION}","page":${page},"total":3,"items":[{"id":${BIG},"name":"商品${page}","note":"${SESSION}"}]` + '}'); return;
    }
    const auth = req.headers.cookie?.includes(`sid=${SESSION}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><meta charset="utf-8"><body data-auth="${auth ? 'yes' : 'no'}"><h1>采集测试后台</h1>
      <p>独立合成站点，不使用真实账号</p><button id="login" onclick="fetch('/login',{method:'POST'}).then(()=>location.reload())">模拟人工登录</button>
      <button id="download">下载全部（非采集路线）</button><button id="query" onclick="query()">刷新列表</button><input id="date" aria-label="开始日期" type="date" value="2026-09-15"><input type="password" value="${SESSION}"><pre id="result"></pre><script>
      async function query(){const r=await fetch('/api/items',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer ${BEARER}'},body:'{"page":1,"big":${BIG}}'}); const d=await r.json(); document.querySelector('#result').textContent=JSON.stringify({name:d.items?.[0]?.name,total:d.total});} ${auth ? 'query();' : ''}
      </script></body></html>`);
  });
  const origin = await listen(server);
  let browser;
  try {
    browser = await openBrowserSession({ profileDir: join(temp, 'profile'), url: origin, headless });
    assert.equal(await browser.page.locator('body').getAttribute('data-auth'), 'no');
    await browser.page.click('#login'); // 合成站点模拟用户本人登录，不代填真实密码。
    await browser.page.waitForFunction(() => document.body.dataset.auth === 'yes');
    await assert.rejects(openBrowserSession({ profileDir: join(temp, 'profile'), url: origin, headless, timeout: 5000 }), /PROFILE_IN_USE/);
    await browser.close();
    browser = await openBrowserSession({ profileDir: join(temp, 'profile'), url: origin, headless });
    assert.equal(await browser.page.locator('body').getAttribute('data-auth'), 'yes');
    assert.equal(browser.status().watching, false);
    await browser.execute({ action: 'observe' });
    let item = await candidate(browser);
    const all = await browser.execute({ action: 'candidates' });
    assert(!JSON.stringify(all).includes(SESSION)); assert(!JSON.stringify(all).includes(BEARER));
    assert.equal(item.method, 'POST'); assert.equal(item.shape.items.count, 1);
    const controls = await browser.execute({ action: 'inspect', allowData: true });
    assert(!JSON.stringify(controls).includes(SESSION));
    assert(!controls.controls.some(control => control.type === 'password'));
    const date = controls.controls.find(control => control.label === '开始日期');
    await browser.execute({ action: 'fill', element: date.id, confirmedQuery: true, value: '2026-09-16' });
    assert.equal(await browser.page.locator('#date').inputValue(), '2026-09-16');
    await browser.execute({ action: 'click', element: controls.controls.find(control => control.label === '刷新列表').id, confirmedQuery: true });
    await browser.execute({ action: 'candidates', waitMs: 100 });
    const projection = { allowData: true, arrayPath: '/items', fields: ['id', 'name', 'note'] };
    const before = calls;
    await assert.rejects(browser.execute({ action: 'query', candidate: item.id }), /QUERY_CONFIRMATION_REQUIRED/);
    await assert.rejects(browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true, patch: { json: { accountId: 2 } } }), /PATCH_FIELD_DENIED/);
    assert.equal(calls, before);
    const first = await browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true, projection });
    const next = await browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true, patch: { json: { page: 2 } }, projection });
    assert.equal(first.preview.rows[0].name, '商品1'); assert.equal(next.preview.rows[0].name, '商品2');
    assert.equal(next.preview.rows[0].id, BIG); assert.equal(next.preview.rows[0].note, '[redacted]'); assert(bodyOK);
    assert(!JSON.stringify(next).includes(SESSION)); assert(!JSON.stringify(next).includes(BEARER));
    for (const [value, code] of [['redirect', 'REDIRECT_BLOCKED'], ['limit', 'RATE_LIMITED'], ['html', 'NOT_JSON_OR_LOGIN'], ['huge', 'RESPONSE_TOO_LARGE']]) {
      mode = value;
      await assert.rejects(browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true }), new RegExp(code));
    }
    assert.equal(foreignCalls, 0);
    mode = 'normal';
    await browser.context.clearCookies();
    await assert.rejects(browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true }), /SESSION_CHANGED/);
    await browser.context.addCookies([{ name: 'sid', value: SESSION, url: origin, httpOnly: true }]);
    await browser.execute({ action: 'observe' }); item = await candidate(browser);
    mode = 'expired';
    await assert.rejects(browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true }), /LOGIN_REQUIRED/);
    assert.equal(browser.status().watching, false); assert.equal(browser.status().candidates, 0);
    mode = 'normal'; await browser.execute({ action: 'observe' }); item = await candidate(browser);
    await browser.page.goto(origin + '/other');
    assert.equal(browser.status().watching, false);
    await assert.rejects(browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true }), /CANDIDATE_NOT_FOUND/);
    await browser.execute({ action: 'observe', reload: false });
    mode = 'slow'; const started = calls;
    await browser.page.evaluate(() => { void query(); });
    for (let i = 0; i < 30 && calls === started; i++) await sleep(10);
    await browser.execute({ action: 'observe', reload: false });
    await sleep(500);
    assert.equal((await browser.execute({ action: 'candidates' })).items.length, 0, '旧观察的迟到请求不进入新观察');
    mode = 'normal'; await browser.execute({ action: 'observe' }); item = await candidate(browser);
    if (process.env.BROWSER_TEST_EVIDENCE_DIR) {
      mkdirSync(process.env.BROWSER_TEST_EVIDENCE_DIR, { recursive: true });
      await browser.page.screenshot({ path: join(process.env.BROWSER_TEST_EVIDENCE_DIR, 'playwright-browser.png') });
    }
    mode = 'slow';
    const inFlight = browser.execute({ action: 'query', candidate: item.id, confirmedQuery: true }).then(() => false, () => true);
    await sleep(30); await browser.execute({ action: 'stop' }); assert(await inFlight);
    assert.equal(browser.status().closed, true);
    await assert.rejects(browser.execute({ action: 'observe' }), /BROWSER_CLOSED/);
  } finally {
    await browser?.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => foreign.close(resolve))]);
    rmSync(temp, { recursive: true, force: true });
  }
});
