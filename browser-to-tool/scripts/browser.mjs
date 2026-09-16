import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, lstatSync, realpathSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync, unlinkSync, linkSync, existsSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserFault, requireThat, publicError, allowedURL } from './browser-data.mjs';

const script = fileURLToPath(import.meta.url);
const MAX_MESSAGE = 65536, MAX_REPLY = 1024 * 1024;
const noFollow = constants.O_NOFOLLOW ?? 0;
function privateDirectory(path) {
  requireThat(isAbsolute(path), 'INVALID_STATE_DIRECTORY');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'INVALID_STATE_DIRECTORY');
  if (process.getuid) requireThat(stat.uid === process.getuid() && !(stat.mode & 0o077), 'STATE_DIRECTORY_NOT_PRIVATE');
  return realpathSync(path);
}
export function runtimeRoot() {
  requireThat(process.platform !== 'win32', 'WINDOWS_RUNTIME_NOT_VERIFIED');
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.LOCALAPPDATA : (process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'));
  requireThat(process.env.BROWSER_TO_TOOL_HOME || base, 'INVALID_STATE_DIRECTORY');
  return privateDirectory(process.env.BROWSER_TO_TOOL_HOME || join(base, 'browser-to-tool'));
}
function profilePaths(profile) {
  requireThat(typeof profile === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(profile), 'INVALID_PROFILE_NAME');
  const parent = privateDirectory(join(runtimeRoot(), 'profiles'));
  const directory = privateDirectory(join(parent, profile));
  return { directory, file: join(directory, 'session.json'), browser: join(directory, 'browser') };
}
function safeOpen(path, flags) {
  try { requireThat(!lstatSync(path).isSymbolicLink(), 'UNSAFE_FILE'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fd = openSync(path, flags | noFollow, 0o600);
  try {
    const stat = fstatSync(fd);
    requireThat(stat.isFile() && stat.nlink === 1, 'UNSAFE_FILE');
    if (process.getuid) requireThat(stat.uid === process.getuid(), 'UNSAFE_FILE');
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
export function readSession(profile) {
  const { file } = profilePaths(profile);
  let fd;
  try { fd = safeOpen(file, constants.O_RDONLY); } catch (error) { if (error.code === 'ENOENT') throw new BrowserFault('NOT_RUNNING'); throw error; }
  try {
    const stat = fstatSync(fd);
    requireThat(stat.size <= 16384 && (!process.getuid || !(stat.mode & 0o077)), 'UNSAFE_SESSION_FILE');
    let value; try { value = JSON.parse(readFileSync(fd, 'utf8')); } catch { throw new BrowserFault('INVALID_SESSION_FILE'); }
    requireThat(Number.isInteger(value.pid) && value.pid > 0 && Number.isInteger(value.port) && value.port > 0 && value.port < 65536 && /^[a-f0-9]{64}$/.test(value.token) && /^[a-f0-9-]{36}$/.test(value.session), 'INVALID_SESSION_FILE');
    return value;
  } finally { closeSync(fd); }
}
function running(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw new BrowserFault('PROCESS_STATE_UNKNOWN'); }
}
export async function callBrowser({ profile = 'default', session, command, output } = {}) {
  const saved = readSession(profile);
  requireThat(session === saved.session, 'STALE_SESSION');
  requireThat(running(saved.pid), 'WORKER_NOT_RUNNING');
  const body = JSON.stringify({ session, command, ...(output ? { output } : {}) });
  requireThat(Buffer.byteLength(body) <= MAX_MESSAGE, 'INPUT_TOO_LARGE');
  let response;
  try { response = await fetch(`http://127.0.0.1:${saved.port}/`, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${saved.token}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(25000) }); }
  catch { throw new BrowserFault('WORKER_UNAVAILABLE'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; requireThat(size <= MAX_REPLY, 'REPLY_TOO_LARGE'); chunks.push(chunk); }
  let answer; try { answer = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BrowserFault('INVALID_WORKER_REPLY'); }
  requireThat(answer.session === session, 'STALE_SESSION');
  if (!answer.ok) throw new BrowserFault(/^[A-Z_]{1,64}$/.test(answer.error) ? answer.error : 'OPERATION_FAILED');
  return answer.result;
}
export function recoverBrowser({ profile = 'default', confirmedStopped } = {}) {
  requireThat(confirmedStopped === true, 'STOP_CONFIRMATION_REQUIRED');
  const { file } = profilePaths(profile), before = lstatSync(file), saved = readSession(profile);
  requireThat(!running(saved.pid), 'WORKER_STILL_RUNNING');
  const after = lstatSync(file);
  requireThat(before.dev === after.dev && before.ino === after.ino && !after.isSymbolicLink(), 'SESSION_FILE_CHANGED');
  unlinkSync(file); // 仅清理已死亡worker的元数据；不碰浏览器锁、profile或其他进程。
  return { recovered: true, profileRetained: true };
}
function childEnvironment() {
  // 不把模型API密钥、NODE_OPTIONS或调试开关传给浏览器worker。
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|TEMP|TMP|TMPDIR|SystemRoot|SYSTEMROOT|WINDIR|LANG|LC_.*|DISPLAY|WAYLAND_DISPLAY|XDG_.*|PLAYWRIGHT_BROWSERS_PATH|BROWSER_TO_TOOL_HOME|__CF_USER_TEXT_ENCODING)$/.test(key)));
}
export async function startBrowser(options) {
  requireThat(Number(process.versions.node.split('.')[0]) >= 22 && typeof JSON.rawJSON === 'function', 'NODE_22_REQUIRED');
  requireThat(options && Object.keys(options).every(key => ['profile', 'workspace', 'url', 'origins', 'headless', 'idleMinutes'].includes(key)));
  const profile = options.profile ?? 'default'; profilePaths(profile);
  requireThat(typeof options.workspace === 'string' && isAbsolute(options.workspace), 'INVALID_WORKSPACE');
  allowedURL(options.url);
  const child = fork(script, ['--worker'], { detached: true, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: childEnvironment() });
  return await new Promise((resolveStart, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new BrowserFault('START_TIMEOUT')); }, 35000);
    function finish(error, result) {
      clearTimeout(timer); child.removeAllListeners('message'); child.removeAllListeners('exit'); child.removeAllListeners('error');
      if (child.connected) child.disconnect(); child.unref();
      error ? reject(error) : resolveStart(result);
    }
    child.once('error', () => finish(new BrowserFault('WORKER_START_FAILED')));
    child.once('exit', () => finish(new BrowserFault('WORKER_START_FAILED')));
    child.once('message', message => {
      if (!message.ok) { finish(new BrowserFault(message.error)); return; }
      child.send({ ack: message.result.session }, error => finish(error ? new BrowserFault('START_CANCELLED') : null, message.result));
    });
    child.send({ ...options, profile });
  });
}

async function worker(options) {
  let runtime, server, timer, ackTimer, fd, entry, paths, closing = false, ownedStat;
  let startupPending = true, acknowledged = false, cancelled = false;
  function cancel() { cancelled = true; if (!startupPending) void shutdown().catch(() => {}); }
  process.once('disconnect', () => { if (!acknowledged) cancel(); });
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  process.on('message', message => { if (entry && message?.ack === entry.session) { acknowledged = true; clearTimeout(ackTimer); } });
  async function notify(message) {
    if (!process.connected) return false;
    return await new Promise(resolveSent => process.send(message, error => resolveSent(!error)));
  }
  let workspace, workspaceStat;
  function workspaceLive() {
    requireThat(realpathSync(workspace) === workspace, 'WORKSPACE_CHANGED');
    const now = lstatSync(workspace);
    requireThat(now.dev === workspaceStat.dev && now.ino === workspaceStat.ino && now.isDirectory(), 'WORKSPACE_CHANGED');
  }
  function record(action, ok, error) {
    workspaceLive();
    const log = safeOpen(join(workspace, '浏览器记录.jsonl'), constants.O_CREAT | constants.O_WRONLY | constants.O_APPEND);
    try { writeFileSync(log, JSON.stringify({ at: new Date().toISOString(), session: entry.session, action, ok, ...(error ? { error } : {}) }) + '\n'); }
    finally { closeSync(log); }
  }
  function outputFile(name, result) {
    const image = Buffer.isBuffer(result);
    requireThat(typeof name === 'string' && (image ? /^(?!\.)[\p{L}\p{N}_ .-]{1,90}\.png$/u : /^(?!\.)[\p{L}\p{N}_ .-]{1,90}\.json$/u).test(name), 'INVALID_OUTPUT_NAME');
    requireThat(!runtime.status().closed, 'BROWSER_CLOSED'); workspaceLive();
    const parent = join(workspace, '输出'); mkdirSync(parent, { mode: 0o700, recursive: true });
    requireThat(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(), 'UNSAFE_OUTPUT_DIRECTORY');
    const target = join(parent, name), temp = join(parent, `.browser-${randomUUID()}.tmp`);
    let file;
    try {
      file = safeOpen(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      writeFileSync(file, image ? result : JSON.stringify(result, null, 2) + '\n'); closeSync(file); file = undefined;
      // hard link原子发布且不覆盖；不支持时明确失败，不降级为覆盖rename。
      linkSync(temp, target);
    } catch (error) { throw new BrowserFault(error.code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_WRITE_FAILED'); }
    finally { if (file !== undefined) closeSync(file); if (existsSync(temp)) unlinkSync(temp); }
    return target;
  }
  async function shutdown() {
    if (closing) return; closing = true; clearTimeout(timer); clearTimeout(ackTimer);
    try { await runtime?.close(); } catch (error) { closing = false; throw error; }
    if (server) { server.closeIdleConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
    if (fd !== undefined) { closeSync(fd); fd = undefined; }
    if (ownedStat && existsSync(paths.file)) {
      const now = lstatSync(paths.file);
      if (now.dev === ownedStat.dev && now.ino === ownedStat.ino && !now.isSymbolicLink()) unlinkSync(paths.file);
    }
  }
  try {
    paths = profilePaths(options.profile);
    requireThat(typeof options.workspace === 'string' && isAbsolute(options.workspace), 'INVALID_WORKSPACE');
    workspace = realpathSync(options.workspace); workspaceStat = lstatSync(workspace);
    requireThat(workspaceStat.isDirectory() && existsSync(join(workspace, '工作记录.md')) && existsSync(join(workspace, '代码')), 'INVALID_WORKSPACE');
    const contains = (parent, child) => { const part = relative(parent, child); return part === '' || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)); };
    requireThat(!contains(workspace, runtimeRoot()) && !contains(runtimeRoot(), workspace), 'PROFILE_IN_WORKSPACE');
    const minutes = options.idleMinutes ?? 30;
    requireThat(Number.isFinite(minutes) && minutes >= 1 / 60 && minutes <= 120, 'INVALID_IDLE_TIMEOUT');
    requireThat(options.origins === undefined || (Array.isArray(options.origins) && options.origins.length <= 10), 'INVALID_ORIGINS');
    try { fd = safeOpen(paths.file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR); }
    catch (error) { if (error.code === 'EEXIST') throw new BrowserFault('PROFILE_IN_USE'); throw error; }
    ownedStat = fstatSync(fd);
    entry = { pid: process.pid, token: randomBytes(32).toString('hex'), session: randomUUID(), workspace };
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => { try { record('idle-stop', true); } catch {} void shutdown().catch(() => {}); }, minutes * 60000); };
    server = createServer(async (request, response) => {
      let authorized = false, action;
      response.on('error', () => {});
      function send(answer) {
        if (response.destroyed || response.writableEnded) return;
        const json = JSON.stringify({ session: entry.session, ...answer });
        response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
        response.end(Buffer.byteLength(json) <= MAX_REPLY ? json : JSON.stringify({ session: entry.session, ok: false, error: 'REPLY_TOO_LARGE' }));
      }
      try {
        const token = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${entry.token}`);
        requireThat(request.method === 'POST' && request.url === '/' && !request.headers.origin && request.headers.host === `127.0.0.1:${entry.port}` && request.headers['content-type'] === 'application/json' && token.length === expected.length && timingSafeEqual(token, expected), 'ACCESS_DENIED');
        authorized = true;
        const chunks = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; requireThat(bytes <= MAX_MESSAGE, 'INPUT_TOO_LARGE'); chunks.push(chunk); }
        let message; try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BrowserFault('INVALID_INPUT'); }
        requireThat(message && Object.keys(message).every(key => ['session', 'command', 'output'].includes(key)) && message.session === entry.session, 'STALE_SESSION');
        action = ['status', 'stop', 'pages', 'select-page', 'screenshot', 'inspect-request', 'observe', 'candidates', 'query', 'inspect', 'click', 'fill'].includes(message.command?.action) ? message.command.action : 'invalid';
        requireThat(runtime && !closing, 'NOT_READY');
        const image = message.command?.action === 'screenshot';
        requireThat(!image || message.output, 'SCREENSHOT_OUTPUT_REQUIRED');
        if (message.output) {
          requireThat(['query', 'candidates', 'inspect', 'inspect-request', 'screenshot'].includes(message.command?.action), 'INVALID_OUTPUT_ACTION');
          requireThat(typeof message.output === 'string' && (image ? /^(?!\.)[\p{L}\p{N}_ .-]{1,90}\.png$/u : /^(?!\.)[\p{L}\p{N}_ .-]{1,90}\.json$/u).test(message.output), 'INVALID_OUTPUT_NAME');
          requireThat(!existsSync(join(workspace, '输出', message.output)), 'OUTPUT_EXISTS');
        }
        touch();
        const version = runtime.status().epoch;
        let result = await runtime.execute(message.command);
        requireThat(!response.destroyed, 'CLIENT_DISCONNECTED');
        if (message.output) requireThat(runtime.status().epoch === version && runtime.status().scope, 'STALE_SCOPE');
        const savedTo = message.output ? outputFile(message.output, image ? result.png : result) : undefined;
        if (image) { const { png, ...metadata } = result; result = metadata; }
        record(message.command.action, true);
        send({ ok: true, result: savedTo ? { ...result, savedTo } : result });
        if (message.command.action === 'stop') void shutdown().catch(() => {}); else if (!closing) touch();
      } catch (error) {
        if (authorized && action && runtime) { try { record(action, false, publicError(error)); } catch {} }
        send({ ok: false, error: publicError(error) });
      }
    });
    server.maxConnections = 8; server.requestTimeout = 25000; server.headersTimeout = 10000;
    server.setTimeout(25000, socket => socket.destroy());
    server.on('clientError', (_error, socket) => socket.destroy());
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    entry.port = server.address().port;
    writeFileSync(fd, JSON.stringify(entry));
    record('starting', true);
    const { openBrowserSession } = await import('./browser-session.mjs');
    runtime = await openBrowserSession({ profileDir: paths.browser, url: options.url, origins: options.origins, headless: options.headless ?? false });
    startupPending = false;
    requireThat(!cancelled && process.connected, 'START_CANCELLED');
    runtime.context.on('close', () => { if (!closing) void shutdown().catch(() => {}); });
    touch(); record('ready', true);
    ackTimer = setTimeout(() => { if (!acknowledged) cancel(); }, 3000);
    requireThat(await notify({ ok: true, result: { profile: options.profile, session: entry.session, workspace, ...runtime.status() } }), 'START_CANCELLED');
  } catch (error) {
    const code = error.code === 'ERR_MODULE_NOT_FOUND' ? 'DEPENDENCY_MISSING' : publicError(error);
    startupPending = false;
    await notify({ ok: false, error: code });
    await shutdown().catch(() => {});
  }
}

async function doctor() {
  if (process.platform === 'win32') return { ready: false, error: 'WINDOWS_RUNTIME_NOT_VERIFIED' };
  requireThat(Number(process.versions.node.split('.')[0]) >= 22 && typeof JSON.rawJSON === 'function', 'NODE_22_REQUIRED');
  try {
    const { chromium } = await import('playwright');
    return { ready: existsSync(chromium.executablePath()), node: process.versions.node, playwright: '1.63.0', browserInstalled: existsSync(chromium.executablePath()) };
  } catch { return { ready: false, node: process.versions.node, dependencyMissing: true }; }
}
function parseArgs(args) {
  const options = {}; const allowed = new Set(['workspace', 'url', 'profile', 'session', 'json', 'out', 'allow-origin', 'idle-minutes', 'headless', 'confirm-stopped']);
  for (let i = 0; i < args.length; i++) {
    requireThat(args[i].startsWith('--')); const key = args[i].slice(2); requireThat(allowed.has(key));
    requireThat(key === 'allow-origin' || !Object.hasOwn(options, key), 'DUPLICATE_OPTION');
    if (key === 'headless' || key === 'confirm-stopped') options[key] = true;
    else { requireThat(i + 1 < args.length && !args[i + 1].startsWith('--')); const value = args[++i]; if (key === 'allow-origin') (options[key] ??= []).push(value); else options[key] = value; }
  }
  return options;
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === '--worker') { process.once('message', options => { void worker(options); }); return; }
  try {
    const options = parseArgs(args); let result;
    if (action === 'doctor') { requireThat(args.length === 0); result = await doctor(); }
    else if (action === 'start') {
      requireThat(Object.keys(options).every(key => ['workspace', 'url', 'profile', 'allow-origin', 'headless', 'idle-minutes'].includes(key)));
      result = await startBrowser({ workspace: options.workspace, url: options.url, profile: options.profile, origins: options['allow-origin'], headless: options.headless, idleMinutes: options['idle-minutes'] === undefined ? undefined : Number(options['idle-minutes']) });
    } else if (action === 'recover') {
      requireThat(Object.keys(options).every(key => ['profile', 'confirm-stopped'].includes(key)));
      result = recoverBrowser({ profile: options.profile, confirmedStopped: options['confirm-stopped'] });
    } else if (['call', 'status', 'stop'].includes(action)) {
      requireThat(Object.keys(options).every(key => ['profile', 'session', ...(action === 'call' ? ['json', 'out'] : [])].includes(key)));
      let command; try { command = action === 'call' ? JSON.parse(options.json) : { action }; } catch { throw new BrowserFault('INVALID_INPUT'); }
      result = await callBrowser({ profile: options.profile, session: options.session, command, output: options.out });
    } else throw new BrowserFault('USAGE: doctor | start | status | call | stop | recover');
    console.log(JSON.stringify({ ok: true, ...result }));
    if (result.ready === false) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ ok: false, error: publicError(error) })); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === script) await main();
