import { createHash } from 'node:crypto';

export class BrowserFault extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireThat(value, code = 'INVALID_INPUT') {
  if (!value) throw new BrowserFault(code);
}
export function publicError(error) {
  return error instanceof BrowserFault ? error.code : 'OPERATION_FAILED';
}
export const MAX_BODY = 1024 * 1024;
const sensitive = /cookie|authorization|password|passwd|secret|token|signature|credential|csrf|session|api.?key|__proto__|constructor|prototype/i;
export const safeKey = key => typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key) && !sensitive.test(key);
export const digest = text => createHash('sha256').update(text).digest('hex');

export function allowedURL(value, origins) {
  let url;
  try { url = new URL(value); } catch { throw new BrowserFault('INVALID_URL'); }
  requireThat(!url.username && !url.password && ['http:', 'https:'].includes(url.protocol), 'INVALID_URL');
  requireThat(url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'HTTPS_REQUIRED');
  if (origins) requireThat(origins.has(url.origin), 'OUT_OF_SCOPE');
  return url;
}
export const hasSecret = (value, secrets) => [...secrets].some(secret => String(value).includes(secret));
export function urlSummary(value, secrets = new Set()) {
  try {
    const url = new URL(value);
    // 路径也可能含签名：默认只给本地匹配用的摘要，不输出路径或参数值。
    return { origin: hasSecret(url.origin, secrets) ? '[redacted]' : url.origin, route: digest(url.origin + url.pathname).slice(0, 16), queryKeys: [...new Set(url.searchParams.keys())].filter(key => safeKey(key) && !hasSecret(key, secrets)).slice(0, 30) };
  } catch { return { origin: null }; }
}
export function parseData(text) {
  return JSON.parse(text, (_key, value, context) => typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) ? context.source : value);
}
export function dataShape(value, secrets = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 200) return '[shape-limit]';
  if (value === null) return 'null';
  if (depth >= 5) return '[depth-limit]';
  if (Array.isArray(value)) return { type: 'array', count: value.length, item: value.length ? dataShape(value[0], secrets, depth + 1, budget) : null };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => safeKey(key) && !hasSecret(key, secrets)).slice(0, 40).map(([key, val]) => [key, dataShape(val, secrets, depth + 1, budget)]));
  return typeof value;
}
export function rememberSecrets(value, secrets, key = '', depth = 0, budget = { nodes: 0 }) {
  requireThat(depth <= 20 && ++budget.nodes <= 20000, 'DATA_TOO_COMPLEX');
  function add(secret) {
    if (secret.length < 4 || secret.length > 4096) return;
    requireThat(secrets.has(secret) || secrets.size < 256, 'SECRET_BUDGET_EXCEEDED');
    secrets.add(secret);
  }
  if (['string', 'number'].includes(typeof value) && sensitive.test(key)) {
    const text = String(value); add(text);
    if (/^Bearer /i.test(text)) add(text.slice(7));
    if (/cookie/i.test(key)) for (const part of text.split(';')) {
      const index = part.indexOf('=');
      if (index >= 0) add(part.slice(index + 1).trim());
    }
  } else if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) rememberSecrets(child, secrets, childKey, depth + 1, budget);
  }
}
export function authenticationFingerprint(...inputs) {
  const hash = createHash('sha256'); let nodes = 0;
  function visit(value, path, selected = false) {
    requireThat(path.length <= 20 && ++nodes <= 20000, 'DATA_TOO_COMPLEX');
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
      if (selected && !entries.length) hash.update(JSON.stringify([path, value]) + '\0');
      for (const [key, child] of entries) visit(child, [...path, key], selected || sensitive.test(key));
    } else if (selected) hash.update(JSON.stringify([path, value]) + '\0');
  }
  inputs.forEach((value, index) => visit(value, [index]));
  return hash.digest('hex'); // 身份摘要用完整认证值，与展示脱敏的长度限制分离。
}
export function previewValue(value, secrets) {
  if (value !== null && ['string', 'number', 'boolean'].includes(typeof value) && hasSecret(value, secrets)) return '[redacted]';
  if (typeof value === 'string') {
    if (value.length > 240 || /https?:\/\/|bearer\s|eyJ[A-Za-z0-9_-]+\.|[A-Za-z0-9_-]{32,}|[\u0000-\u001f]/i.test(value) || [...secrets].some(secret => value.includes(secret))) return '[redacted]';
    return value;
  }
  return value === null || typeof value === 'boolean' || typeof value === 'number' ? value : '[structured-value]';
}
export function atPointer(value, pointer) {
  requireThat(typeof pointer === 'string' && pointer.length <= 512 && (pointer === '' || pointer.startsWith('/')));
  for (const segment of pointer === '' ? [] : pointer.slice(1).split('/')) {
    requireThat(!/~(?![01])/u.test(segment));
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    requireThat(safeKey(key), 'INVALID_FIELD');
    requireThat(value !== null && typeof value === 'object' && Object.hasOwn(value, key), 'FIELD_NOT_FOUND');
    value = value[key];
  }
  return value;
}
export function projectData(data, projection, secrets) {
  if (!projection) return undefined;
  requireThat(projection.allowData === true && Array.isArray(projection.fields) && projection.fields.length > 0 && projection.fields.length <= 20 && projection.fields.every(safeKey), 'DATA_APPROVAL_REQUIRED');
  requireThat(Object.keys(projection).every(key => ['allowData', 'arrayPath', 'fields', 'limit'].includes(key)));
  const array = atPointer(data, projection.arrayPath ?? '');
  requireThat(Array.isArray(array), 'ARRAY_NOT_FOUND');
  const limit = projection.limit ?? 10;
  requireThat(Number.isInteger(limit) && limit >= 1 && limit <= 100);
  rememberSecrets(data, secrets);
  requireThat(projection.fields.every(key => !hasSecret(key, secrets)), 'INVALID_FIELD');
  return { totalInResponse: array.length, returned: Math.min(array.length, limit), truncated: array.length > limit,
    rows: array.slice(0, limit).map(row => {
      requireThat(row && typeof row === 'object' && !Array.isArray(row), 'INVALID_ROW');
      requireThat(projection.fields.every(key => Object.hasOwn(row, key)), 'FIELD_NOT_FOUND');
      return Object.fromEntries(projection.fields.map(key => [key, previewValue(row[key], secrets)]));
    }) };
}
const editable = /^(page|pageno|pagenumber|pageindex|pagesize|size|limit|offset|cursor|after|before|start|end|startdate|enddate|starttime|endtime|datefrom|dateto|from|to|date)$/;
export function changedRequest(record, patch = {}) {
  requireThat(patch && typeof patch === 'object' && !Array.isArray(patch) && Object.keys(patch).every(key => ['query', 'json'].includes(key)));
  const url = new URL(record.url);
  let body = record.body;
  for (const area of Object.keys(patch)) {
    const changes = patch[area];
    requireThat(changes && typeof changes === 'object' && !Array.isArray(changes) && Object.keys(changes).length <= 12);
    let object;
    if (area === 'json') {
      requireThat(record.method === 'POST' && /application\/json/i.test(record.headers['content-type'] ?? ''), 'JSON_POST_REQUIRED');
      try { object = JSON.parse(body, (_key, value, context) => typeof value === 'number' ? JSON.rawJSON(context.source) : value); } catch { throw new BrowserFault('INVALID_JSON_BODY'); }
      requireThat(object && typeof object === 'object' && !Array.isArray(object));
    }
    for (const [key, value] of Object.entries(changes)) {
      requireThat(safeKey(key) && editable.test(key.replaceAll('_', '').toLowerCase()), 'PATCH_FIELD_DENIED');
      requireThat((typeof value === 'string' && value.length <= 2048) || (typeof value === 'number' && Number.isFinite(value)), 'INVALID_PATCH');
      if (area === 'query') { requireThat(url.searchParams.getAll(key).length === 1, 'FIELD_NOT_FOUND'); url.searchParams.set(key, String(value)); }
      else { requireThat(Object.hasOwn(object, key), 'FIELD_NOT_FOUND'); object[key] = value; }
    }
    if (area === 'json') body = JSON.stringify(object);
  }
  return { url: url.href, body };
}
