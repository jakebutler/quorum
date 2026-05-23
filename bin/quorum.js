#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0] || "help";
const rest = args.slice(1);
const flags = parseFlags(rest);

const apiBase = process.env.QUORUM_API_BASE || "https://quorum.corvolabs.com";

if (command === "init") await init(flags);
else if (command === "dev") dev(rest);
else if (command === "build") run("vite", ["build", ...rest]);
else if (command === "deploy") run("wrangler", ["pages", "deploy", "dist", ...rest]);
else if (command === "dashboard") dashboard(flags);
else if (command === "export") exportLocalSqlite(flags);
else if (command === "local-server") await localServer(flags);
else help();

async function init(flags) {
  const title = flags.title || "Q1 landing page review";
  const showRanking = bool(flags["show-ranking"], true);
  const showThumbnails = bool(flags["show-thumbnails"], true);
  const collectName = choice(flags["collect-name"], ["off", "optional", "required"], "off");
  const collectEmail = choice(flags["collect-email"], ["off", "optional", "required"], "off");
  const notifyEmail = flags["notify-email"] || process.env.QUORUM_NOTIFY_EMAIL || "";
  const provision = await fetchJson(`${apiBase}/api/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientHint: `quorum-cli@${readPackageVersion()}`, notifyEmail })
  });

  writeIfMissing("content/welcome.md", "# Welcome\n\nReview each option and leave a quick signal.\n");
  writeIfMissing("content/thankyou.md", "# Thank you\n\nYour feedback has been recorded.\n");
  fs.mkdirSync("content/reviews", { recursive: true });
  fs.writeFileSync(
    "quorum.config.json",
    `${JSON.stringify({
      title,
      showRanking,
      maxRankingPicks: 3,
      collectName,
      collectEmail,
      showThumbnails,
      reviewsDir: "./content/reviews",
      hideBranding: false,
      unsafeAllowSameOrigin: false
    }, null, 2)}\n`
  );
  fs.writeFileSync(
    ".env.local",
    [
      `VITE_QUORUM_PROJECT_TOKEN=${provision.projectToken}`,
      "VITE_QUORUM_STORAGE_ADAPTER=corvo",
      `QUORUM_DASHBOARD_URL=${provision.dashboardUrl}`,
      `QUORUM_NOTIFY_EMAIL=${notifyEmail}`
    ].join("\n") + "\n"
  );

  emit(flags, provision, [
    `Project provisioned.`,
    `Dashboard: ${provision.dashboardUrl}`,
    `Next: drop files into content/reviews, then run npm run build.`
  ]);
}

function dashboard(flags) {
  const env = readEnv(".env.local");
  const url = env.QUORUM_DASHBOARD_URL || "";
  if (!url) throw new Error("QUORUM_DASHBOARD_URL is missing from .env.local.");
  emit(flags, { dashboardUrl: url }, [url]);
}

function dev(rest) {
  const env = readEnv(".env.local");
  if ((env.VITE_QUORUM_STORAGE_ADAPTER || env.QUORUM_STORAGE_ADAPTER) !== "local-sqlite") {
    run("vite", ["dev", ...rest]);
  }
  const api = spawn(process.execPath, [fileURLToPath(import.meta.url), "local-server"], { stdio: "inherit", env: process.env });
  const vite = spawn("vite", ["dev", ...rest], { stdio: "inherit", shell: process.platform === "win32" });
  const stop = (code = 0) => {
    api.kill();
    vite.kill();
    process.exit(code);
  };
  api.on("exit", (code) => stop(code ?? 1));
  vite.on("exit", (code) => stop(code ?? 0));
}

async function localServer(flags) {
  const port = Number(flags.port || process.env.QUORUM_LOCAL_API_PORT || 8789);
  initLocalDb();
  const server = http.createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "POST,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("content-type", "application/json");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    try {
      const body = await readRequestJson(request);
      if (request.url === "/api/sessions" && request.method === "POST") return sendJson(response, createLocalSession(body));
      if (request.url === "/api/responses" && request.method === "POST") return sendJson(response, saveLocalResponse(body));
      if (request.url === "/api/rankings" && request.method === "POST") return sendJson(response, saveLocalRanking(body));
      if (request.url === "/api/complete" && request.method === "POST") return sendJson(response, completeLocalSession(body));
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Bad request" }));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Quorum local SQLite adapter listening on http://127.0.0.1:${port}`);
    console.log(`Database: ${localDbPath()}`);
  });
}

function exportLocalSqlite(flags) {
  initLocalDb();
  const data = {
    sessions: sqliteJson("SELECT * FROM sessions ORDER BY started_at"),
    votes: sqliteJson("SELECT * FROM responses ORDER BY session_id, option_id"),
    rankings: sqliteJson("SELECT * FROM rankings ORDER BY session_id")
  };
  const files = csvFiles(data);
  const output = String(flags.output || "quorum-export.zip");
  fs.writeFileSync(output, makeZip(files));
  emit(flags, { path: output, files: Object.keys(files) }, [`Wrote ${output}`]);
}

function help() {
  console.log(`Quorum

Commands:
  quorum init [--yes] [--title <s>] [--show-ranking <bool>] [--collect-email off|optional|required] [--collect-name off|optional|required] [--show-thumbnails <bool>] [--notify-email <email>] [--json]
  quorum dev
  quorum build
  quorum deploy
  quorum export
  quorum local-server [--port 8789]
  quorum dashboard [--json]
`);
}

function fileURLToPath(url) {
  return new URL(url).pathname;
}

function initLocalDb() {
  fs.mkdirSync(path.dirname(localDbPath()), { recursive: true });
  sqliteExec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_token TEXT NOT NULL,
      anonymous_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      vote TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(session_id, option_id)
    );
    CREATE TABLE IF NOT EXISTS rankings (
      session_id TEXT PRIMARY KEY,
      picks_json TEXT NOT NULL,
      overall_note TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

function createLocalSession(body) {
  const id = `qs_${randomBase64Url(18)}`;
  const now = unix();
  sqliteExec(`INSERT INTO sessions (id, project_token, anonymous_id, name, email, started_at) VALUES (${sql(id)}, ${sql(required(body.projectToken, "projectToken"))}, ${sql(required(body.anonymousId, "anonymousId"))}, ${sql(optional(body.name))}, ${sql(optional(body.email))}, ${now});`);
  return { sessionId: id };
}

function saveLocalResponse(body) {
  const now = unix();
  const vote = body.vote === "up" || body.vote === "down" ? body.vote : null;
  sqliteExec(`
    INSERT INTO responses (id, session_id, option_id, vote, note, created_at, updated_at)
    VALUES (${sql(`qr_${randomBase64Url(18)}`)}, ${sql(required(body.sessionId, "sessionId"))}, ${sql(required(body.optionId, "optionId"))}, ${sql(vote)}, ${sql(optional(body.note))}, ${now}, ${now})
    ON CONFLICT(session_id, option_id) DO UPDATE SET vote = excluded.vote, note = excluded.note, updated_at = excluded.updated_at;
  `);
  return { ok: true };
}

function saveLocalRanking(body) {
  const now = unix();
  const picks = Array.isArray(body.picks) ? body.picks.slice(0, 3).map(String) : [];
  sqliteExec(`
    INSERT INTO rankings (session_id, picks_json, overall_note, updated_at)
    VALUES (${sql(required(body.sessionId, "sessionId"))}, ${sql(JSON.stringify(picks))}, ${sql(optional(body.overallNote))}, ${now})
    ON CONFLICT(session_id) DO UPDATE SET picks_json = excluded.picks_json, overall_note = excluded.overall_note, updated_at = excluded.updated_at;
  `);
  return { ok: true };
}

function completeLocalSession(body) {
  sqliteExec(`UPDATE sessions SET completed_at = COALESCE(completed_at, ${unix()}) WHERE id = ${sql(required(body.sessionId, "sessionId"))};`);
  return { ok: true };
}

function sqliteExec(sqlText) {
  const result = spawnSync("sqlite3", [localDbPath(), sqlText], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "sqlite3 failed");
  return result.stdout;
}

function sqliteJson(sqlText) {
  const result = spawnSync("sqlite3", ["-json", localDbPath(), sqlText], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "sqlite3 failed");
  return JSON.parse(result.stdout || "[]");
}

function localDbPath() {
  return path.resolve(process.env.QUORUM_SQLITE_PATH || ".quorum/quorum.sqlite");
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, body) {
  response.writeHead(200);
  response.end(JSON.stringify(body));
}

function csvFiles(data) {
  const rankingRows = data.rankings.flatMap((row) => safeJson(row.picks_json).map((option_id, index) => ({
    session_id: row.session_id,
    pick_position: index + 1,
    option_id,
    overall_note: row.overall_note,
    updated_at: row.updated_at
  })));
  const optionIds = [...new Set(data.votes.map((row) => String(row.option_id)))].sort();
  const rankingsBySession = new Map(data.rankings.map((row) => [row.session_id, row]));
  const votesBySession = new Map();
  for (const vote of data.votes) {
    const rows = votesBySession.get(String(vote.session_id)) || [];
    rows.push(vote);
    votesBySession.set(String(vote.session_id), rows);
  }
  const summary = data.sessions.map((session) => {
    const row = {
      session_id: session.id,
      name: session.name,
      email: session.email,
      started_at: session.started_at,
      completed_at: session.completed_at,
      completed: session.completed_at ? "true" : "false"
    };
    const sessionVotes = votesBySession.get(String(session.id)) || [];
    optionIds.forEach((option, index) => {
      const prefix = `option_${String(index + 1).padStart(2, "0")}`;
      const vote = sessionVotes.find((item) => item.option_id === option);
      row[`${prefix}_vote`] = vote?.vote || "";
      row[`${prefix}_note`] = vote?.note || "";
    });
    const ranking = rankingsBySession.get(session.id);
    const picks = ranking ? safeJson(ranking.picks_json) : [];
    row.ranking_1st = picks[0] || "";
    row.ranking_2nd = picks[1] || "";
    row.ranking_3rd = picks[2] || "";
    row.overall_note = ranking?.overall_note || "";
    return row;
  });
  return {
    "summary.csv": toCsv(summary),
    "sessions.csv": toCsv(data.sessions, ["id", "anonymous_id", "name", "email", "started_at", "completed_at"]),
    "votes.csv": toCsv(data.votes, ["session_id", "option_id", "vote", "note", "created_at", "updated_at"]),
    "rankings.csv": toCsv(rankingRows, ["session_id", "pick_position", "option_id", "overall_note", "updated_at"])
  };
}

function toCsv(rows, preferred) {
  const headers = preferred || [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeJson(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = zipHeader(0x04034b50, filename, data.length, crc, 0);
    chunks.push(local, data);
    central.push(zipHeader(0x02014b50, filename, data.length, crc, offset));
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  return concat([...chunks, ...central, endRecord(Object.keys(files).length, centralSize, centralOffset)]);
}

function zipHeader(signature, filename, size, crc, offset) {
  const central = signature === 0x02014b50;
  const length = central ? 46 : 30;
  const view = new DataView(new ArrayBuffer(length));
  let p = 0;
  view.setUint32(p, signature, true); p += 4;
  if (central) { view.setUint16(p, 20, true); p += 2; }
  view.setUint16(p, 20, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  view.setUint32(p, crc, true); p += 4;
  view.setUint32(p, size, true); p += 4;
  view.setUint32(p, size, true); p += 4;
  view.setUint16(p, filename.length, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  if (central) {
    view.setUint16(p, 0, true); p += 2;
    view.setUint16(p, 0, true); p += 2;
    view.setUint16(p, 0, true); p += 2;
    view.setUint32(p, 0, true); p += 4;
    view.setUint32(p, offset, true);
  }
  return concat([new Uint8Array(view.buffer), filename]);
}

function endRecord(count, size, offset) {
  const view = new DataView(new ArrayBuffer(22));
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return new Uint8Array(view.buffer);
}

function crc32(data) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optional(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function randomBase64Url(bytes) {
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(random).toString("base64url");
}

function unix() {
  return Math.floor(Date.now() / 1000);
}

function run(bin, args) {
  const result = spawnSync(bin, args, { stdio: "inherit", shell: process.platform === "win32" });
  process.exit(result.status ?? 1);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function bool(value, fallback) {
  if (value === undefined) return fallback;
  return value === true || value === "true";
}

function choice(value, allowed, fallback) {
  if (!value) return fallback;
  if (!allowed.includes(value)) throw new Error(`Expected one of ${allowed.join(", ")}`);
  return value;
}

function emit(flags, json, lines) {
  if (flags.json) console.log(JSON.stringify(json, null, 2));
  else console.log(lines.join("\n"));
}

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

function writeIfMissing(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    return index < 0 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
  }));
}
