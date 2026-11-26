import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3002);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "tier-list.db");
const SESSION_COOKIE = "tlm_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:3002",
  "http://localhost:3002",
]);

const app = express();
// Increased the payload limit to 50mb to allow for base64 image saving
app.use(express.json({ limit: "50mb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function stringifyPayload(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

function newId() {
  return crypto.randomUUID();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function scryptHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(key.toString("hex"));
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptHash(password, salt);
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt, storedHash] = String(stored || "").split(":");
  if (!salt || !storedHash) return false;
  const computed = await scryptHash(password, salt);
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  header.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // skip cookies that fail to decode
    }
  });
  return cookies;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production";
  const attrs = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return typeof password === "string"
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

const loginAttempts = new Map();
let db;

function checkRateLimit(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec) return true;
  if (rec.blockUntil && rec.blockUntil > now) return false;
  return true;
}

function registerFailure(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key) || { count: 0, blockUntil: 0 };
  rec.count += 1;
  if (rec.count >= 8) {
    rec.blockUntil = now + 1000 * 60 * 10;
    rec.count = 0;
  }
  loginAttempts.set(key, rec);
}

function clearFailures(key) {
  loginAttempts.delete(key);
}

async function initDb() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tier_lists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

async function insertImage(userId, mime, data) {
  const id = newId();
  await db.run(
    `INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, userId, mime, data, new Date().toISOString()]
  );
  return `/api/images/${id}`;
}

// One-time move of base64 data URL covers out of list payloads into the images table.
async function migrateInlineImages() {
  const rows = await db.all(
    `SELECT id, user_id FROM tier_lists WHERE payload_json LIKE '%"data:image/%'`
  );
  if (!rows.length) return;

  const backupPath = `${DB_PATH}.bak-${Date.now()}`;
  await db.run(`VACUUM INTO ?`, [backupPath]);
  console.log(`Backed up DB to ${backupPath}, migrating images in ${rows.length} lists`);

  for (const { id, user_id: userId } of rows) {
    const { payload_json: json } = await db.get(`SELECT payload_json FROM tier_lists WHERE id = ?`, [id]);
    const payload = JSON.parse(json);
    const tiles = [...(payload.tiers || []).flatMap(t => t.tiles || []), ...(payload.tray || [])];

    await db.exec("BEGIN");
    try {
      for (const tile of tiles) {
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(tile?.cover || "");
        if (!match) continue;
        tile.cover = await insertImage(userId, match[1], Buffer.from(match[2], "base64"));
      }
      await db.run(`UPDATE tier_lists SET payload_json = ? WHERE id = ?`, [JSON.stringify(payload), id]);
      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }
  }
}

async function createSession(userId) {
  const token = makeSessionToken();
  const id = newId();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, hashToken(token), expiresAt, new Date().toISOString()]
  );
  return token;
}

async function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await db.get(
    `SELECT s.id, s.user_id, s.expires_at, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    [tokenHash]
  );

  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    await db.run(`DELETE FROM sessions WHERE id = ?`, [session.id]);
    return null;
  }

  return session;
}

const authRequired = asyncHandler(async (req, res, next) => {
  const session = await getSessionFromRequest(req);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Not authenticated" });
  }

  req.user = { id: session.user_id, email: session.email, sessionId: session.id };
  next();
});

function normalizeListPayload(payload) {
  if (!payload || !Array.isArray(payload.tiers)) return null;
  return payload;
}

app.post("/api/register", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error: "Password must be at least 8 chars with an uppercase letter and a symbol",
      });
    }

    const exists = await db.get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (exists) {
      return res.status(409).json({ error: "Account already exists" });
    }

    const userId = newId();
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES (?, ?, ?, ?)`,
      [userId, email, passwordHash, now]
    );

    const defaultPayload = JSON.stringify({
      tiers: ["S", "A", "B", "C", "D"].map(label => ({ id: newId(), label, tiles: [] })),
    });

    await db.run(
      `INSERT INTO tier_lists (id, user_id, name, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), userId, "My Tier List", defaultPayload, now, now]
    );

    const token = await createSession(userId);
    setSessionCookie(res, token);
    return res.status(201).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const rateKey = `${req.ip}:${email}`;

    if (!checkRateLimit(rateKey)) {
      return res.status(429).json({ error: "Too many attempts. Try later." });
    }

    const user = await db.get(`SELECT id, email, password_hash FROM users WHERE email = ?`, [email]);
    if (!user) {
      registerFailure(rateKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      registerFailure(rateKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    clearFailures(rateKey);
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/logout", authRequired, asyncHandler(async (req, res) => {
  await db.run(`DELETE FROM sessions WHERE id = ?`, [req.user.sessionId]);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get("/api/me", authRequired, asyncHandler(async (req, res) => {
  res.json({ email: req.user.email, userId: req.user.id });
}));

app.get("/api/lists", authRequired, asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT id, name, updated_at
     FROM tier_lists
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
    [req.user.id]
  );

  const lists = rows.map(row => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
  }));

  res.json({ lists });
}));

app.get("/api/lists/:id", authRequired, asyncHandler(async (req, res) => {
  const row = await db.get(
    `SELECT id, name, payload_json, updated_at
     FROM tier_lists
     WHERE id = ? AND user_id = ?`,
    [String(req.params.id || ""), req.user.id]
  );
  if (!row) return res.status(404).json({ error: "List not found" });

  res.json({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    payload: JSON.parse(row.payload_json),
  });
}));

app.post("/api/lists", authRequired, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80) || "Untitled";
  const payload = normalizeListPayload(req.body?.payload);

  const payloadJson = payload && stringifyPayload(payload);
  if (!payloadJson) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const id = newId();
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO tier_lists (id, user_id, name, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, req.user.id, name, payloadJson, now, now]
  );

  res.status(201).json({ id });
}));

app.put("/api/lists/:id", authRequired, asyncHandler(async (req, res) => {
  const listId = String(req.params.id || "");
  const name = String(req.body?.name || "").trim().slice(0, 80) || "Untitled";
  const payload = normalizeListPayload(req.body?.payload);

  const payloadJson = payload && stringifyPayload(payload);
  if (!payloadJson) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const exists = await db.get(
    `SELECT id FROM tier_lists WHERE id = ? AND user_id = ?`,
    [listId, req.user.id]
  );

  if (!exists) return res.status(404).json({ error: "List not found" });

  await db.run(
    `UPDATE tier_lists
     SET name = ?, payload_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [name, payloadJson, new Date().toISOString(), listId, req.user.id]
  );

  res.json({ ok: true });
}));

app.delete("/api/lists/:id", authRequired, asyncHandler(async (req, res) => {
  const listId = String(req.params.id || "");
  const existing = await db.get(
    `SELECT id FROM tier_lists WHERE id = ? AND user_id = ?`,
    [listId, req.user.id]
  );
  if (!existing) return res.status(404).json({ error: "List not found" });

  await db.run(`DELETE FROM tier_lists WHERE id = ? AND user_id = ?`, [listId, req.user.id]);
  res.json({ ok: true });
}));

app.post(
  "/api/images",
  authRequired,
  express.raw({ type: () => true, limit: "100mb" }),
  asyncHandler(async (req, res) => {
    const mime = String(req.headers["content-type"] || "");
    if (!mime.startsWith("image/") || !Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: "Invalid image" });
    }
    const url = await insertImage(req.user.id, mime, req.body);
    res.status(201).json({ url });
  })
);

app.get("/api/images/:id", authRequired, asyncHandler(async (req, res) => {
  const row = await db.get(
    `SELECT mime, data FROM images WHERE id = ? AND user_id = ?`,
    [String(req.params.id || ""), req.user.id]
  );
  if (!row) return res.status(404).json({ error: "Image not found" });
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.type(row.mime).send(row.data);
}));

app.get(["/", "/index.html"], asyncHandler(async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (!session) {
    clearSessionCookie(res);
    return res.redirect(302, "/login");
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
}));

app.get(["/login", "/login.html"], asyncHandler(async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (session) {
    return res.redirect(302, "/");
  }
  return res.sendFile(path.join(__dirname, "public", "login.html"));
}));

app.get(["/register", "/register.html"], asyncHandler(async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (session) {
    return res.redirect(302, "/");
  }
  return res.sendFile(path.join(__dirname, "public", "register.html"));
}));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status === 413) {
    return res.status(413).json({ error: "List too large to save. Remove or use smaller images." });
  }
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: "Bad request" });
  }
  res.status(500).json({ error: "Internal server error" });
});

await initDb();
await migrateInlineImages();
app.listen(PORT, () => {
  console.log(`Tier list app listening on ${PORT}`);
});