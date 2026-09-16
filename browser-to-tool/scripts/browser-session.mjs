import { chromium } from 'playwright';
import { mkdirSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserFault, requireThat, allowedURL, urlSummary, digest, MAX_BODY, parseData, dataShape, rememberSecrets, projectData, changedRequest, previewValue, authenticationFingerprint } from './browser-data.mjs';

const cookieKey = value => digest((value ?? '').split(';').map(part => part.trim()).filter(Boolean).sort().join(';'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function openBrowserSession({ profileDir, url, origins = [], headless = false, timeout = 15000 }) {
  requireThat(process.platform !== 'win32', 'WINDOWS_RUNTIME_NOT_VERIFIED');
  requireThat(Number(process.versions.node.split('.')[0]) >= 22 && typeof JSON.rawJSON === 'function', 'NODE_22_REQUIRED');
  requireThat(isAbsolute(profileDir) && typeof headless === 'boolean');
  const initial = allowedURL(url);
  const scope = new Set([initial.origin, ...origins.map(origin => {
    const parsed = allowedURL(origin);
    requireThat(parsed.origin === origin, 'INVALID_ORIGIN');
    return origin;
  })]);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  requireThat(lstatSync(profileDir).isDirectory() && !lstatSync(profileDir).isSymbolicLink(), 'INVALID_PROFILE');
  let context;
  try { context = await chromium.launchPersistentContext(profileDir, { channel: 'chromium', headless, timeout, acceptDownloads: false }); }
  catch (error) {
    if (/Executable doesn't exist/.test(error.message)) throw new BrowserFault('BROWSER_NOT_INSTALLED');
    if (/ProcessSingleton|SingletonLock|profile.*in use|existing browser session|现有的浏览器会话/i.test(error.message)) throw new BrowserFault('PROFILE_IN_USE');
    throw new BrowserFault('BROWSER_START_FAILED');
  }
  const page = context.pages()[0] ?? await context.newPage();
  let closePromise, closed = false, watching = false, epoch = 0, armReload = false, omitted = 0, bodyBytes = 0, busy = false;
  const records = new Map(), pending = new Set(), secrets = new Set(), requests = new WeakMap(), controls = new Map(), authIdentities = new Map();
  const inScope = () => { try { allowedURL(page.url(), scope); return true; } catch { return false; } };
  function releaseControls() { for (const { handle } of controls.values()) void handle.dispose().catch(() => {}); controls.clear(); }
  function revoke() { epoch++; watching = false; records.clear(); authIdentities.clear(); bodyBytes = 0; releaseControls(); }
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    revoke();
    watching = armReload && inScope(); armReload = false;
  });
  context.on('close', () => { closed = true; revoke(); });
  page.on('close', () => { closed = true; revoke(); void context.close().catch(() => {}); });
  const status = () => ({ closed, watching, epoch, scope: inScope(), page: urlSummary(page.url(), secrets), candidates: records.size, omitted, pending: pending.size, busy });
  function live(version = epoch) { requireThat(!closed, 'BROWSER_CLOSED'); requireThat(version === epoch && inScope(), 'STALE_SCOPE'); }

  async function learnResponse(response, target) {
    for (const header of await response.headersArray()) rememberSecrets({ [header.name]: header.value }, secrets);
    for (const cookie of await context.cookies(target)) rememberSecrets({ cookie: cookie.value }, secrets);
  }
  async function capture(request, version) {
    try {
      const response = await request.response();
      if (!response) return;
      const headers = await request.allHeaders();
      rememberSecrets(headers, secrets);
      const requestURL = new URL(request.url());
      for (const [key, value] of requestURL.searchParams) rememberSecrets({ [key]: value }, secrets);
      const body = request.postData() ?? undefined;
      if (body && Buffer.byteLength(body) > 65536) { omitted++; return; }
      let bodyData;
      if (body) { try { bodyData = parseData(body); } catch {} }
      const identity = request.method() + requestURL.origin + requestURL.pathname;
      const fingerprint = authenticationFingerprint(headers, [...requestURL.searchParams].map(([key, value]) => ({ [key]: value })), bodyData);
      live(version);
      if (authIdentities.has(identity) && authIdentities.get(identity) !== fingerprint) { revoke(); return; }
      authIdentities.set(identity, fingerprint);
      await learnResponse(response, request.url());
      const code = response.status();
      if ([401, 403].includes(code)) { if (epoch === version) revoke(); return; }
      const type = await response.headerValue('content-type') ?? '';
      if (!/application\/(?:[\w.-]+\+)?json/i.test(type) || code < 200 || code >= 300) return;
      const length = Number(await response.headerValue('content-length'));
      if (length > MAX_BODY || bodyBytes >= 8 * MAX_BODY) { omitted++; return; }
      // Playwright已缓冲响应；这是解析/留存上限，不是底层下载的硬内存上限。
      const buffer = await response.body();
      if (buffer.length > MAX_BODY || bodyBytes + buffer.length > 8 * MAX_BODY) { omitted++; return; }
      const data = parseData(buffer.toString('utf8'));
      live(version);
      if (!watching) return;
      rememberSecrets(data, secrets);
      if (body) { try { rememberSecrets(parseData(body), secrets); } catch {} }
      const id = randomUUID();
      bodyBytes += buffer.length;
      records.set(id, { id, epoch: version, url: request.url(), method: request.method(), headers, body, data, cookie: cookieKey(headers.cookie), status: code });
    } catch (error) {
      if (!closed && epoch === version) {
        omitted++;
        if (['SECRET_BUDGET_EXCEEDED', 'DATA_TOO_COMPLEX'].includes(error.code)) revoke();
      }
    }
  }
  page.on('request', request => {
    try {
      if (watching && !closed && inScope() && ['fetch', 'xhr'].includes(request.resourceType()) && request.frame() === page.mainFrame()) {
        allowedURL(request.url(), scope); requests.set(request, epoch);
      }
    } catch { /* 非授权来源和不支持的frame不纳入调查。 */ }
  });
  page.on('requestfinished', request => {
    try {
      const version = requests.get(request);
      if (!watching || closed || version === undefined || version !== epoch || !inScope()) return;
      if (records.size + pending.size >= 50 || pending.size >= 6) { omitted++; return; }
      const job = capture(request, version); pending.add(job);
      void job.finally(() => pending.delete(job));
    } catch { omitted++; }
  });

  const describe = element => ({ tag: element.tagName.toLowerCase(), type: element.getAttribute('type') ?? '', label: (element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.textContent || element.getAttribute('name') || element.id || '').trim(), href: element.getAttribute('href') ?? '' });
  async function inspect({ allowData } = {}) {
    live(); requireThat(allowData === true, 'DATA_APPROVAL_REQUIRED');
    const version = epoch; releaseControls();
    rememberSecrets({ cookie: (await context.cookies(page.url())).map(cookie => `${cookie.name}=${cookie.value}`).join(';') }, secrets);
    const elements = page.locator('button, a, input:not([type=hidden]):not([type=password]), textarea, select');
    const count = await elements.count(), items = [];
    for (let i = 0; i < Math.min(count, 40); i++) {
      const handle = await elements.nth(i).elementHandle();
      if (!handle) continue;
      if (!await handle.isVisible()) { await handle.dispose(); continue; }
      const info = await handle.evaluate(describe); live(version);
      const id = randomUUID(); controls.set(id, { handle, fingerprint: digest(JSON.stringify(info)), epoch: version });
      items.push({ id, tag: info.tag, type: previewValue(info.type, secrets), label: previewValue(info.label.slice(0, 241), secrets) });
    }
    live(version); return { controls: items, truncated: count > 40 };
  }
  async function interact({ element, confirmedQuery, value }, action) {
    live(); requireThat(confirmedQuery === true, 'QUERY_CONFIRMATION_REQUIRED');
    const control = controls.get(element); requireThat(control && control.epoch === epoch, 'STALE_ELEMENT');
    const info = await control.handle.evaluate(describe); live(control.epoch);
    requireThat(digest(JSON.stringify(info)) === control.fingerprint && await control.handle.isVisible(), 'STALE_ELEMENT');
    if (action === 'fill') {
      requireThat(['input', 'textarea', 'select'].includes(info.tag) && !/password|密码|口令|验证码|密钥|令牌|secret|token|credential/i.test(info.type + info.label), 'SENSITIVE_INPUT');
      requireThat(typeof value === 'string' && value.length <= 240 && previewValue(value, secrets) === value, 'INVALID_INPUT');
      if (info.tag === 'select') await control.handle.selectOption(value, { timeout });
      else await control.handle.fill(value, { timeout });
    } else {
      if (info.href) allowedURL(new URL(info.href, page.url()).href, scope);
      await control.handle.click({ timeout });
    }
    requireThat(!closed, 'BROWSER_CLOSED'); return status();
  }

  async function observe({ reload = true } = {}) {
    live(); requireThat(typeof reload === 'boolean');
    revoke(); omitted = 0; watching = true;
    if (reload) {
      armReload = true;
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout }); }
      catch { revoke(); throw new BrowserFault('NAVIGATION_FAILED'); }
      finally { armReload = false; }
    }
    return status();
  }
  async function candidates({ waitMs = 0 } = {}) {
    live(); requireThat(Number.isInteger(waitMs) && waitMs >= 0 && waitMs <= 5000);
    if (waitMs) await delay(waitMs);
    live();
    return { ...status(), items: [...records.values()].map(record => ({ id: record.id, method: record.method, status: record.status, ...urlSummary(record.url, secrets), shape: dataShape(record.data, secrets),
      bodyShape: (() => { try { return dataShape(parseData(record.body), secrets); } catch { return record.body ? 'non-json' : null; } })() })) };
  }
  async function query({ candidate, confirmedQuery, patch = {}, projection } = {}) {
    live(); requireThat(confirmedQuery === true, 'QUERY_CONFIRMATION_REQUIRED');
    const record = records.get(candidate);
    requireThat(record && record.epoch === epoch, 'CANDIDATE_NOT_FOUND');
    requireThat(['GET', 'POST'].includes(record.method), 'METHOD_NOT_SUPPORTED');
    if (record.method === 'POST') {
      let json; try { json = JSON.parse(record.body); } catch { throw new BrowserFault('JSON_POST_REQUIRED'); }
      requireThat(/application\/json/i.test(record.headers['content-type'] ?? ''), 'JSON_POST_REQUIRED');
      if (json?.operationName || /\/graphql(?:\/|$)/i.test(new URL(record.url).pathname)) requireThat(typeof json?.query === 'string' && /^\s*(query\b|\{)/.test(json.query), 'GRAPHQL_QUERY_REQUIRED');
      requireThat(!(typeof json?.query === 'string' && /\b(?:mutation|subscription)\b/.test(json.query)), 'GRAPHQL_QUERY_REQUIRED');
    }
    const version = epoch;
    const { url: target, body } = changedRequest(record, patch);
    allowedURL(target, scope);
    requireThat(!/\b(?:mutation|subscription)\b/.test(new URL(target).searchParams.get('query') ?? ''), 'GRAPHQL_QUERY_REQUIRED');
    if (projection) projectData(record.data, projection, secrets); // 在发送请求前验证字段与数据输出授权。
    const cookies = await context.cookies(target);
    live(version);
    requireThat(cookieKey(cookies.map(cookie => `${cookie.name}=${cookie.value}`).join(';')) === record.cookie, 'SESSION_CHANGED');
    const headers = Object.fromEntries(Object.entries(record.headers).filter(([key]) => !/^(cookie|host|connection|content-length|accept-encoding|proxy-.*|sec-.*)$/i.test(key)));
    let response, result;
    try {
      response = await context.request.fetch(target, { method: record.method, headers, ...(body === undefined ? {} : { data: body }), timeout, maxRedirects: 0, maxRetries: 0 });
      live(version);
      await learnResponse(response, target);
      const code = response.status();
      if ([401, 403].includes(code)) { revoke(); throw new BrowserFault('LOGIN_REQUIRED'); }
      requireThat(code < 300 || code >= 400, 'REDIRECT_BLOCKED');
      requireThat(code !== 429, 'RATE_LIMITED');
      requireThat(code >= 200 && code < 300, 'HTTP_FAILED');
      requireThat(/application\/(?:[\w.-]+\+)?json/i.test(response.headers()['content-type'] ?? ''), 'NOT_JSON_OR_LOGIN');
      const buffer = await response.body();
      requireThat(buffer.length <= MAX_BODY, 'RESPONSE_TOO_LARGE');
      let data; try { data = parseData(buffer.toString('utf8')); } catch { throw new BrowserFault('INVALID_JSON_RESPONSE'); }
      requireThat(!data?.errors, 'BUSINESS_ERROR');
      rememberSecrets(data, secrets);
      live(version);
      result = { status: code, method: record.method, ...urlSummary(target, secrets), shape: dataShape(data, secrets), ...(projection ? { preview: projectData(data, projection, secrets) } : {}) };
    } finally { await response?.dispose().catch(() => {}); }
    live(version); return result;
  }
  async function execute(command) {
    requireThat(command && typeof command === 'object' && !Array.isArray(command));
    const { action, ...args } = command;
    const fields = { status: [], stop: [], observe: ['reload'], candidates: ['waitMs'], query: ['candidate', 'confirmedQuery', 'patch', 'projection'], inspect: ['allowData'], click: ['element', 'confirmedQuery'], fill: ['element', 'confirmedQuery', 'value'] };
    requireThat(Object.hasOwn(fields, action), 'UNKNOWN_ACTION');
    requireThat(Object.keys(args).every(key => fields[action].includes(key)));
    if (action === 'status') return status();
    if (action === 'stop') { await close(); return { stopped: true }; }
    requireThat(!busy, 'BUSY'); busy = true;
    try {
      if (action === 'inspect') return await inspect(args);
      if (action === 'click' || action === 'fill') return await interact(args, action);
      if (action === 'observe') return await observe(args);
      if (action === 'candidates') return await candidates(args);
      if (action === 'query') return await query(args);
      throw new BrowserFault('UNKNOWN_ACTION');
    } finally { busy = false; }
  }
  async function close() {
    if (!closePromise) {
      closed = true; revoke();
      closePromise = context.close().catch(() => { closePromise = undefined; throw new BrowserFault('BROWSER_CLOSE_FAILED'); });
    }
    return await closePromise;
  }
  try { await page.goto(initial.href, { waitUntil: 'domcontentloaded', timeout }); }
  catch { await close(); throw new BrowserFault('NAVIGATION_FAILED'); }
  // context/page仅供本地集成测试和同进程编程；CLI不向模型提供任意evaluate或Cookie导出。
  return { context, page, execute, close, status };
}
