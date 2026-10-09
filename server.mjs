import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateInitData } from './auth.mjs';
import { initialSettings, validateSettings, validateExpense, dateKey } from './public/shared.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, 'dist');
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export function createApp({ token = process.env.BOT_TOKEN || '', dataDir = path.resolve(root, process.env.DATA_DIR || 'data'), publicUrl = process.env.PUBLIC_URL || '', maxAgeSeconds = Number(process.env.AUTH_MAX_AGE_SECONDS || 86400) } = {}) {
  const queues = new Map();
  const canonicalOrigin = publicUrl && token ? new URL(publicUrl).origin : null;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60) throw new Error('AUTH_MAX_AGE_SECONDS must be an integer >= 60');
  const fileFor = userId => path.join(dataDir, `${userId}.json`);
  async function readProfile(userId) {
    try {
      const data = JSON.parse(await readFile(fileFor(userId), 'utf8'));
      data.settings = validateSettings(data.settings);
      if (!Array.isArray(data.expenses)) throw new Error('Invalid stored profile');
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') return { settings: initialSettings(), expenses: [] };
      throw err;
    }
  }
  const visible = data => ({ settings: data.settings, expenses: data.expenses.filter(e => !e.deletedAt) });
  async function transaction(userId, callback) {
    const previous = queues.get(userId) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const profile = await readProfile(userId);
      const result = callback(profile);
      await mkdir(dataDir, { recursive: true });
      const destination = fileFor(userId);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
      await rename(temporary, destination);
      return result;
    });
    queues.set(userId, current);
    try { return await current; }
    finally { if (queues.get(userId) === current) queues.delete(userId); }
  }
  async function bodyOf(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw new RequestError('请使用 JSON 格式。', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) throw new RequestError('请求太大。', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new RequestError('JSON 格式有误。'); }
  }
  function send(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(payload));
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/config' && req.method === 'GET') { send(res, 200, { mode: token ? 'telegram' : 'local' }); return; }
      if (url.pathname.startsWith('/api/')) {
        if (!token) throw new RequestError('本机预览无需服务端账本。', 503);
        let user;
        try { user = validateInitData(req.headers['x-telegram-init-data'], token, { maxAgeSeconds }); }
        catch { throw new RequestError('请从 Telegram bot 重新打开。', 401); }
        const id = String(user.id);
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
          const allowedOrigin = canonicalOrigin || `http://${req.headers.host}`;
          if (req.headers.origin !== allowedOrigin) throw new RequestError('请求来源不匹配。', 403);
        }
        if (url.pathname === '/api/profile' && req.method === 'GET') {
          await queues.get(id)?.catch(() => {});
          send(res, 200, visible(await readProfile(id))); return;
        }
        if (url.pathname === '/api/settings' && req.method === 'PUT') {
          let settings;
          try { settings = validateSettings(await bodyOf(req)); }
          catch (err) { throw err instanceof RequestError ? err : new RequestError(err.message); }
          send(res, 200, await transaction(id, profile => { profile.settings = settings; return visible(profile); })); return;
        }
        if (url.pathname === '/api/expenses' && req.method === 'POST') {
          const payload = await bodyOf(req);
          const entry = await transaction(id, profile => {
            const existing = profile.expenses.find(e => e.id === payload?.id);
            if (existing) {
              if (existing.deletedAt) throw new RequestError('这笔记录已移除，请重新输入。', 409);
              return existing;
            }
            let valid;
            try { valid = validateExpense(payload, profile.settings); }
            catch (err) { throw new RequestError(err.message); }
            if (profile.expenses.length >= 10000) throw new RequestError('账本已达 10000 笔容量，请备份后扩展存储。', 409);
            const now = new Date();
            const record = { ...valid, createdAt: now.toISOString(), dayKey: dateKey(now, valid.timezone) };
            profile.expenses.push(record); return record;
          });
          send(res, 200, entry); return;
        }
        const recordRoute = /^\/api\/expenses\/([a-zA-Z0-9_-]{8,64})(\/restore)?$/.exec(url.pathname);
        if (recordRoute && ((req.method === 'DELETE' && !recordRoute[2]) || (req.method === 'POST' && recordRoute[2]))) {
          send(res, 200, await transaction(id, profile => {
            const entry = profile.expenses.find(e => e.id === recordRoute[1]);
            if (!entry) throw new RequestError('找不到这笔记录。', 404);
            if (req.method === 'DELETE') entry.deletedAt = new Date().toISOString();
            else delete entry.deletedAt;
            return entry;
          })); return;
        }
        throw new RequestError('接口不存在。', 404);
      }
      if (url.pathname === '/health' && req.method === 'GET') { send(res, 200, { ok: true }); return; }
      const isIndex = url.pathname === '/' || url.pathname === '/index.html';
      const assetName = /^\/assets\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname)?.[1];
      const contentType = isIndex ? 'text/html' : assetName && contentTypes[path.extname(assetName)];
      if (contentType && ['GET', 'HEAD'].includes(req.method)) {
        let content;
        try { content = await readFile(isIndex ? path.join(distDir, 'index.html') : path.join(distDir, 'assets', assetName)); }
        catch (error) { if (error.code === 'ENOENT') throw new RequestError('页面不存在。', 404); throw error; }
        res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      send(res, 404, { error: '页面不存在。' });
    } catch (err) {
      if (!(err instanceof RequestError)) console.error('Request failed:', err.name, err.code || 'internal');
      if (!res.headersSent) send(res, err.status || 500, { error: err instanceof RequestError ? err.message : '暂时没有保存成功，请稍后重试。' });
      else res.end();
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  app.listen(port, host, () => console.log(`for. is ready at http://${host}:${port} (${process.env.BOT_TOKEN ? 'Telegram authentication enabled' : 'local preview'})`));
  process.on('SIGINT', () => app.close(() => process.exit(0)));
  process.on('SIGTERM', () => app.close(() => process.exit(0)));
}
