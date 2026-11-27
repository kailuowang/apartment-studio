import { get, put, BlobNotFoundError } from '@vercel/blob';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ITEMS = 500;
const MAX_SAVED_LAYOUTS = 50;

const ROOM_PATHS = {
  default: 'apartment-studio/layout.json',
  verify: 'apartment-studio/verify.json',
};

function getAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return null;
  if (origin === 'https://kailuowang.github.io') return origin;
  if (/^https:\/\/apartment-studio-sync(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return origin;
  if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) return origin;
  return null;
}

function setBaseSecurityHeaders(res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function sanitizeItem(entry, index) {
  if (!isPlainObject(entry)) {
    throw new Error(`Item #${index + 1} must be an object`);
  }
  const clean = {};
  if (typeof entry.catalogId === 'string') clean.catalogId = entry.catalogId.slice(0, 64);
  if (typeof entry.name === 'string') clean.name = entry.name.slice(0, 120);
  if (typeof entry.style === 'string') clean.style = entry.style.slice(0, 64);
  if (typeof entry.color === 'string') clean.color = entry.color.slice(0, 32);
  for (const numKey of ['wIn', 'dIn', 'hIn']) {
    if (entry[numKey] !== undefined) {
      const n = Number(entry[numKey]);
      if (!Number.isFinite(n) || n <= 0 || n > 1000) {
        throw new Error(`Item #${index + 1} has invalid ${numKey}`);
      }
      clean[numKey] = n;
    }
  }
  for (const coordKey of ['x', 'z', 'rot']) {
    if (entry[coordKey] !== undefined) {
      const n = Number(entry[coordKey]);
      if (!Number.isFinite(n)) {
        throw new Error(`Item #${index + 1} has invalid ${coordKey}`);
      }
      clean[coordKey] = n;
    }
  }
  return clean;
}

function sanitizeCeilingFt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 6 || n > 20) {
    throw new Error('ceiling_ft must be between 6 and 20');
  }
  return n;
}

function sanitizeIso(raw, fallback) {
  if (typeof raw === 'string' && raw.length <= 64 && !Number.isNaN(Date.parse(raw))) {
    return new Date(raw).toISOString();
  }
  return fallback;
}

function sanitizeSavedLayouts(rawList) {
  if (!Array.isArray(rawList) || rawList.length > MAX_SAVED_LAYOUTS) {
    throw new Error(`savedLayouts must be an array of at most ${MAX_SAVED_LAYOUTS} entries`);
  }
  return rawList.map((entry, idx) => {
    if (!isPlainObject(entry) || !Array.isArray(entry.items) || entry.items.length > MAX_ITEMS) {
      throw new Error(`savedLayouts[${idx}] must be an object with at most ${MAX_ITEMS} items`);
    }
    const clean = {
      name: typeof entry.name === 'string' ? entry.name.slice(0, 120) : 'Untitled Layout',
      savedAt: sanitizeIso(entry.savedAt, new Date().toISOString()),
      ceiling_ft: sanitizeCeilingFt(entry.ceiling_ft),
      version: Number.isFinite(Number(entry.version)) ? Number(entry.version) : 2,
      items: entry.items.map(sanitizeItem),
    };
    if (typeof entry.id === 'string' && entry.id.length <= 64) {
      clean.id = entry.id;
    }
    return clean;
  });
}

function validateAndSanitizePayload(body) {
  if (!isPlainObject(body)) {
    throw new Error('Request body must be a JSON object');
  }
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) {
    throw new Error(`items must be an array of at most ${MAX_ITEMS} entries`);
  }
  const nowIso = new Date().toISOString();
  const savedAt = sanitizeIso(body.savedAt, nowIso);
  const ceiling_ft = sanitizeCeilingFt(body.ceiling_ft);
  const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 64) : '';
  const items = body.items.map(sanitizeItem);
  const clean = {
    version: 3,
    savedAt,
    clientId,
    ceiling_ft,
    items,
  };
  if (body.savedLayouts !== undefined) {
    clean.savedLayouts = sanitizeSavedLayouts(body.savedLayouts);
  }
  return clean;
}

async function readJsonBody(req) {
  const cl = Number(req.headers['content-length']);
  if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) {
    const err = new Error('Payload too large');
    err.statusCode = 413;
    throw err;
  }

  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        throw err;
      }
      try {
        return JSON.parse(req.body);
      } catch {
        const err = new Error('Invalid JSON');
        err.statusCode = 400;
        throw err;
      }
    }
    if (isPlainObject(req.body) || Array.isArray(req.body)) {
      if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > MAX_BODY_BYTES) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        throw err;
      }
      return req.body;
    }
    const err = new Error('Unsupported request body');
    err.statusCode = 400;
    throw err;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      const err = new Error('Payload too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('Invalid JSON');
    err.statusCode = 400;
    throw err;
  }
}

export default async function handler(req, res) {
  setBaseSecurityHeaders(res);

  const rawOrigin = req.headers.origin;
  if (rawOrigin) {
    const allowedOrigin = getAllowedOrigin(rawOrigin);
    if (!allowedOrigin) {
      return sendJson(res, 403, { error: 'Origin not allowed' });
    }
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, 'http://localhost');
  const room = reqUrl.searchParams.get('room') || 'default';
  const pathname = Object.prototype.hasOwnProperty.call(ROOM_PATHS, room) ? ROOM_PATHS[room] : null;
  if (!pathname) {
    return sendJson(res, 400, { error: 'Invalid room parameter' });
  }

  if (req.method === 'GET') {
    try {
      const queryIfNoneMatch = reqUrl.searchParams.get('ifNoneMatch') || '';
      const headerIfNoneMatch = typeof req.headers['if-none-match'] === 'string'
        ? req.headers['if-none-match']
        : '';
      const rawTag = queryIfNoneMatch || headerIfNoneMatch;
      const normalizedTag = rawTag ? rawTag.replace(/^W\//i, '') : undefined;
      const result = await get(pathname, {
        access: 'private',
        useCache: false,
        ifNoneMatch: normalizedTag,
      });
      if (!result) {
        return sendJson(res, 200, { empty: true });
      }
      if (result.blob?.etag) {
        res.setHeader('ETag', result.blob.etag);
      }
      const resEtagNorm = result.blob?.etag ? result.blob.etag.replace(/^W\//i, '') : '';
      if (result.statusCode === 304 || (queryIfNoneMatch && normalizedTag && resEtagNorm === normalizedTag)) {
        if (queryIfNoneMatch) {
          return sendJson(res, 200, {
            unchanged: true,
            etag: result.blob?.etag || normalizedTag,
          });
        }
        res.statusCode = 304;
        res.end();
        return;
      }
      const text = await new Response(result.stream).text();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(text);
      return;
    } catch (err) {
      if (err instanceof BlobNotFoundError) {
        return sendJson(res, 200, { empty: true });
      }
      return sendJson(res, 500, { error: err?.message || 'Failed to read layout' });
    }
  }

  if (req.method === 'PUT') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, err?.statusCode || 400, { error: err?.message || 'Invalid request body' });
    }

    let clean;
    try {
      clean = validateAndSanitizePayload(body);
    } catch (err) {
      return sendJson(res, 400, { error: err?.message || 'Invalid layout payload' });
    }

    try {
      const result = await put(pathname, JSON.stringify(clean), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      if (result.etag) {
        res.setHeader('ETag', result.etag);
      }
      return sendJson(res, 200, {
        ok: true,
        savedAt: clean.savedAt,
        etag: result.etag || null,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err?.message || 'Failed to save layout' });
    }
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}
