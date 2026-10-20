'use strict';
// One-off Storage file copy: Supabase cloud (read-only) -> self-hosted storage-api file backend.
//
// Method "A": place each object directly into the file backend layout
//   <FILE_STORAGE_BACKEND_PATH>/<GLOBAL_S3_BUCKET>/<TENANT_ID>/<bucket_id>/<name>/<version>
// so that the already restored storage.objects rows (id, version, metadata, created_at, ...)
// stay valid and are NOT touched. The script never writes to the database
// (read-only session) and only issues GET/POST-list requests to the cloud.
//
// Runs inside the supabase/storage-api image so that it uses the very same
// `fs-xattr` module and `resolveSecureFilesystemPath` helper as the backend itself.
//
// Secrets come from the environment only and are never logged.
// The log (/restore/storage-copy.log) contains object names -> mode 600, server only.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const xattr = require('/app/node_modules/fs-xattr');
const { Client } = require('/app/node_modules/pg');
const { resolveSecureFilesystemPath } = require('/app/dist/storage/backend/secure-path');

// Crash diagnostics: written to a 600 file on the server only (messages may contain object paths).
function crashLog(kind, e) {
  try {
    fs.appendFileSync('/restore/storage-copy.err', new Date().toISOString() + ' ' + kind + ' ' + String((e && (e.stack || e.message)) || e) + '\n', { mode: 0o600 });
  } catch (_) {}
}
process.on('uncaughtException', (e) => { crashLog('uncaught', e); process.exit(3); });
process.on('unhandledRejection', (e) => { crashLog('unhandled', e); process.exit(3); });
process.on('beforeExit', (c) => crashLog('beforeExit(event loop drained)', 'code=' + c));
process.on('SIGTERM', () => { crashLog('SIGTERM', ''); process.exit(143); });
process.on('exit', (c) => crashLog('exit', 'code=' + c));

const MODE = process.env.MODE || 'dryrun'; // dryrun | copy
const CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.CONCURRENCY || 6)));
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY_BUCKET = process.env.ONLY_BUCKET || '';
const MAX_ATTEMPTS = 6;
const ROOT = process.env.FILE_ROOT || '/var/lib/storage';
const GLOBAL = process.env.GLOBAL_S3_BUCKET || 'stub';
const TENANT = process.env.TENANT_ID || 'evo';
const CLOUD_REF = 'iosckaqtovbbnssqcpde';
const LOG = '/restore/storage-copy.log';
const PROGRESS = '/restore/storage-copy.progress.json';
const SUMMARY = MODE === 'copy' ? '/restore/storage-copy.summary.json' : '/restore/storage-dryrun.summary.json';

const CLOUD_URL = (process.env.CLOUD_URL || '').replace(/\/+$/, '');
const CLOUD_KEY = process.env.CLOUD_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!CLOUD_URL.includes(CLOUD_REF)) fatal('cloud url does not match expected project ref');
if (!CLOUD_KEY) fatal('cloud key missing');
if (!DATABASE_URL) fatal('database url missing');

function fatal(msg) {
  try {
    fs.writeFileSync(PROGRESS, JSON.stringify({ state: 'fatal', message: String(msg), t: new Date().toISOString() }), { mode: 0o600 });
  } catch (_) {}
  console.error('FATAL:', msg);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- log ----------
let logFd = null;
if (MODE === 'copy') {
  logFd = fs.openSync(LOG, 'a', 0o600);
  fs.fchmodSync(logFd, 0o600);
}
function logLine(o) {
  if (logFd === null) return;
  fs.writeSync(logFd, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
}

// ---------- cloud (read-only) ----------
function cloudHeaders(extra) {
  const h = { apikey: CLOUD_KEY, ...(extra || {}) };
  if (CLOUD_KEY.startsWith('eyJ')) h.authorization = `Bearer ${CLOUD_KEY}`; // legacy JWT key
  return h;
}
function cloudFetch(pathQuery, init, timeoutMs) {
  return fetch(CLOUD_URL + pathQuery, {
    ...(init || {}),
    headers: cloudHeaders(init && init.headers),
    signal: AbortSignal.timeout(timeoutMs || 60000),
  });
}
function isRetryableStatus(s) {
  return s === 429 || s >= 500;
}
function backoff(attempt) {
  return Math.min(30000, 500 * 2 ** attempt) + Math.floor(Math.random() * 500);
}
async function cloudJson(pathQuery, init) {
  let lastErr;
  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    try {
      const r = await cloudFetch(pathQuery, init, 60000);
      if (!r.ok) {
        const e = new Error('http ' + r.status);
        e.status = r.status;
        await r.arrayBuffer().catch(() => {});
        if (!isRetryableStatus(r.status)) {
          e.fatal = true;
          throw e;
        }
        throw e;
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      await sleep(backoff(a));
    }
  }
  throw lastErr;
}

async function listFolder(bucket, prefix) {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await cloudJson(`/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    out.push(...page);
    if (page.length < 1000) break;
    offset += page.length;
  }
  return out;
}

// Flat listing via list-v2 (cursor pagination, no delimiter): one pass over the bucket.
// Returns Map name -> {size, etag, id, version}.
async function listBucketFlat(bucket) {
  const files = new Map();
  let cursor;
  for (;;) {
    const body = { prefix: '', limit: 1000, with_delimiter: false };
    if (cursor) body.cursor = cursor;
    const page = await cloudJson(`/storage/v1/object/list-v2/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    for (const it of page.objects || []) {
      files.set(it.name, { size: Number(it.metadata && it.metadata.size), etag: it.metadata && it.metadata.eTag, id: it.id, version: it.version });
    }
    if (!page.hasNext || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return files;
}

async function listBucket(bucket) {
  try {
    return await listBucketFlat(bucket);
  } catch (e) {
    if (!e.status || e.status >= 500) throw e;
    console.log('list-v2 unavailable, falling back to recursive list for', bucket, 'status', e.status);
    return await listBucketRecursive(bucket);
  }
}

// Fallback: recursive listing via the v1 folder API. Returns Map name -> {size, etag}
async function listBucketRecursive(bucket) {
  const files = new Map();
  const queue = [''];
  let active = 0;
  await new Promise((resolve, reject) => {
    let failed = false;
    const pump = () => {
      if (failed) return;
      while (active < 4 && queue.length) {
        const prefix = queue.shift();
        active++;
        listFolder(bucket, prefix)
          .then((items) => {
            for (const it of items) {
              const full = prefix ? `${prefix}/${it.name}` : it.name;
              if (it.id === null || it.id === undefined) queue.push(full); // folder
              else files.set(full, { size: Number(it.metadata && it.metadata.size), etag: it.metadata && it.metadata.eTag });
            }
          })
          .then(() => {
            active--;
            if (!queue.length && active === 0) resolve();
            else pump();
          })
          .catch((e) => {
            failed = true;
            reject(e);
          });
      }
      if (!queue.length && active === 0) resolve();
    };
    pump();
  });
  return files;
}

// ---------- copy ----------
class Hasher extends Transform {
  constructor() {
    super();
    this.md5 = crypto.createHash('md5');
    this.sha = crypto.createHash('sha256');
    this.bytes = 0;
  }
  _transform(chunk, _enc, cb) {
    this.md5.update(chunk);
    this.sha.update(chunk);
    this.bytes += chunk.length;
    cb(null, chunk);
  }
}
function plainMd5(etag) {
  const m = /^"?([0-9a-f]{32})"?$/i.exec(String(etag || ''));
  return m ? m[1].toLowerCase() : null;
}
async function hashFile(file) {
  const md5 = crypto.createHash('md5');
  const sha = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    md5.update(chunk);
    sha.update(chunk);
    bytes += chunk.length;
  }
  return { md5: md5.digest('hex'), sha256: sha.digest('hex'), bytes };
}
async function applyMeta(file, meta) {
  const mime = meta.mimetype || meta.contentType || 'application/octet-stream';
  await xattr.setAttribute(file, 'user.supabase.content-type', mime);
  if (meta.cacheControl) await xattr.setAttribute(file, 'user.supabase.cache-control', meta.cacheControl);
  if (meta.lastModified) {
    const d = new Date(meta.lastModified);
    if (!Number.isNaN(d.getTime())) await fsp.utimes(file, d, d);
  }
}
function encPath(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

async function copyOne(row) {
  const bucket = row.bucket_id;
  const name = row.name;
  const version = row.version;
  const meta = row.metadata || {};
  const obj = `${bucket}/${name}`;
  const expSize = Number.isFinite(Number(meta.size)) ? Number(meta.size) : null;
  const expMd5 = plainMd5(meta.eTag);

  let dest;
  try {
    dest = resolveSecureFilesystemPath(ROOT, `${GLOBAL}/${TENANT}/${bucket}/${name}/${version}`);
  } catch (_) {
    return { status: 'invalid-key', obj, size: expSize };
  }

  // idempotency: already there with matching size (+ md5 when the cloud etag is a plain md5)
  try {
    const st = await fsp.stat(dest);
    if (st.isFile() && (expSize === null || st.size === expSize)) {
      const h = await hashFile(dest);
      if (!expMd5 || h.md5 === expMd5) {
        await applyMeta(dest, meta);
        return { status: 'skip', obj, size: h.bytes, sha256: h.sha256 };
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') return { status: 'fs-' + (e.code || 'error'), obj, size: expSize };
  }

  const tmp = dest + '.part';
  let reason = 'unknown';
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    try {
      const r = await cloudFetch(`/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encPath(name)}`, {}, 180000);
      if (r.status === 404 || r.status === 400) {
        await r.arrayBuffer().catch(() => {});
        // Storage returns 400 with a "not found" body for some missing objects
        return { status: 'missing-in-cloud', obj, size: expSize, attempts: attempt, note: 'http ' + r.status };
      }
      if (!r.ok) {
        await r.arrayBuffer().catch(() => {});
        reason = 'http-' + r.status;
        if (!isRetryableStatus(r.status)) break;
        throw new Error(reason);
      }
      await fsp.mkdir(require('node:path').dirname(dest), { recursive: true });
      const hasher = new Hasher();
      if (r.body) await pipeline(Readable.fromWeb(r.body), hasher, fs.createWriteStream(tmp, { mode: 0o644 }));
      else await fsp.writeFile(tmp, '');
      const md5 = hasher.md5.digest('hex');
      const sha256 = hasher.sha.digest('hex');
      if (expSize !== null && hasher.bytes !== expSize) {
        reason = 'integrity-size';
        throw new Error(reason);
      }
      if (expMd5 && md5 !== expMd5) {
        reason = 'integrity-md5';
        throw new Error(reason);
      }
      await applyMeta(tmp, meta);
      await fsp.rename(tmp, dest);
      return { status: 'ok', obj, size: hasher.bytes, sha256, attempts: attempt };
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (!String(e.message).startsWith('integrity') && !String(e.message).startsWith('http-')) {
        reason = e.code ? 'net-' + e.code : e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'net-' + (e.cause && e.cause.code ? e.cause.code : 'error');
        if (e.code === 'ENOSPC' || e.code === 'EACCES' || e.code === 'ENAMETOOLONG') {
          reason = 'fs-' + e.code;
          break;
        }
      }
      if (attempt < MAX_ATTEMPTS) await sleep(backoff(attempt));
    }
  }
  return { status: 'fail', obj, size: expSize, attempts: attemptsMade, note: reason };
}

// ---------- main ----------
const t0 = Date.now();
const stats = {}; // per bucket
const bstat = (b) =>
  (stats[b] ||= {
    cloud_listed_count: 0, cloud_listed_bytes: 0,
    db_rows: 0, db_bytes: 0,
    only_in_cloud: 0, only_in_db: 0, size_mismatch: 0, etag_mismatch: 0, id_mismatch: 0, version_mismatch: 0,
    ok: 0, skip: 0, failed: 0, fail_reasons: {},
    disk_count: 0, disk_bytes: 0,
  });
const totals = { ok: 0, skip: 0, failed: 0, bytes: 0, done: 0, total: 0 };

function writeProgress(state) {
  try {
    fs.writeFileSync(PROGRESS, JSON.stringify({ state, mode: MODE, elapsed_s: Math.round((Date.now() - t0) / 1000), ...totals }), { mode: 0o600 });
  } catch (_) {}
}

(async () => {
  writeProgress('starting');
  const db = new Client({ connectionString: DATABASE_URL, options: '-c default_transaction_read_only=on' });
  await db.connect();
  const localBuckets = (await db.query('select id from storage.buckets order by id')).rows.map((r) => r.id);
  const rows = (
    await db.query(
      `select id, bucket_id, name, version, metadata from storage.objects
       where coalesce(is_delete_marker,false) = false and archived_at is null
       order by bucket_id, name collate "C"`
    )
  ).rows;
  await db.end();

  const cloudBuckets = (await cloudJson('/storage/v1/bucket', { method: 'GET' })).map((b) => b.id);
  const bucketCompare = {
    cloud: cloudBuckets.length,
    local: localBuckets.length,
    only_cloud: cloudBuckets.filter((b) => !localBuckets.includes(b)).length,
    only_local: localBuckets.filter((b) => !cloudBuckets.includes(b)).length,
  };
  console.log('buckets', JSON.stringify(bucketCompare));

  const byBucket = new Map();
  for (const r of rows) {
    if (!byBucket.has(r.bucket_id)) byBucket.set(r.bucket_id, []);
    byBucket.get(r.bucket_id).push(r);
  }
  for (const b of localBuckets) {
    bstat(b);
  }

  const work = [];
  for (const b of cloudBuckets) {
    if (ONLY_BUCKET && b !== ONLY_BUCKET) continue;
    const s = bstat(b);
    const listed = await listBucket(b);
    for (const [, v] of listed) {
      s.cloud_listed_count++;
      s.cloud_listed_bytes += Number.isFinite(v.size) ? v.size : 0;
    }
    const dbRows = byBucket.get(b) || [];
    const dbNames = new Set(dbRows.map((r) => r.name));
    for (const [n] of listed) if (!dbNames.has(n)) s.only_in_cloud++;
    for (const r of dbRows) {
      s.db_rows++;
      const dsz = Number(r.metadata && r.metadata.size);
      s.db_bytes += Number.isFinite(dsz) ? dsz : 0;
      const c = listed.get(r.name);
      if (!c) s.only_in_db++;
      else {
        if (Number.isFinite(c.size) && Number.isFinite(dsz) && c.size !== dsz) s.size_mismatch++;
        if (c.etag && r.metadata && r.metadata.eTag && c.etag !== r.metadata.eTag) s.etag_mismatch++;
        if (c.id && r.id && c.id !== r.id) s.id_mismatch++;
        if (c.version && r.version && c.version !== r.version) s.version_mismatch++;
      }
      work.push(r);
    }
    console.log('listed', b, 'cloud', s.cloud_listed_count, 'db', s.db_rows);
    writeProgress('listing');
  }

  let queue = work;
  if (LIMIT > 0) queue = queue.slice(0, LIMIT);
  totals.total = queue.length;

  if (MODE === 'copy') {
    logLine({ event: 'run-start', mode: MODE, concurrency: CONCURRENCY, objects: queue.length });
    const tick = setInterval(() => {
      writeProgress('copying');
      console.log(`progress done=${totals.done}/${totals.total} ok=${totals.ok} skip=${totals.skip} failed=${totals.failed} bytes=${totals.bytes}`);
    }, 20000);
    let idx = 0;
    const worker = async () => {
      for (;;) {
        const i = idx++;
        if (i >= queue.length) return;
        const row = queue[i];
        const res = await copyOne(row);
        const s = bstat(row.bucket_id);
        totals.done++;
        if (res.status === 'ok' || res.status === 'skip') {
          s[res.status]++;
          totals[res.status]++;
          totals.bytes += res.size || 0;
        } else {
          s.failed++;
          totals.failed++;
          const k = res.status === 'fail' ? res.note : res.status;
          s.fail_reasons[k] = (s.fail_reasons[k] || 0) + 1;
        }
        logLine({ status: res.status, obj: res.obj, size: res.size, sha256: res.sha256, attempts: res.attempts, note: res.note });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    clearInterval(tick);

    // on-disk accounting for every DB row of the processed buckets
    for (const row of queue) {
      try {
        const dest = resolveSecureFilesystemPath(ROOT, `${GLOBAL}/${TENANT}/${row.bucket_id}/${row.name}/${row.version}`);
        const st = await fsp.stat(dest);
        if (st.isFile()) {
          const s = bstat(row.bucket_id);
          s.disk_count++;
          s.disk_bytes += st.size;
        }
      } catch (_) {}
    }
    logLine({ event: 'run-end', ok: totals.ok, skip: totals.skip, failed: totals.failed, bytes: totals.bytes });
  }

  const summary = { mode: MODE, elapsed_s: Math.round((Date.now() - t0) / 1000), buckets: bucketCompare, totals, per_bucket: stats };
  fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2), { mode: 0o600 });
  fs.chmodSync(SUMMARY, 0o600);
  writeProgress('done');
  console.log('SUMMARY', JSON.stringify(summary));
  process.exit(0); // failures (if any) are in the summary; non-zero exit is reserved for crashes (docker restarts those)
})().catch((e) => fatal(e && e.message ? e.message : e));
