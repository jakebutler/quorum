#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0] || "help";
const rest = args.slice(1);
const flags = parseFlags(rest);

const apiBase = process.env.QUORUM_API_BASE || "https://quorum.corvolabs.com";

if (command === "init") await init(flags);
else if (command === "dev") run("vite", ["dev", ...rest]);
else if (command === "build") run("vite", ["build", ...rest]);
else if (command === "deploy") run("wrangler", ["pages", "deploy", "dist", ...rest]);
else if (command === "dashboard") dashboard(flags);
else if (command === "export") localExport(flags);
else help();

async function init(flags) {
  const title = flags.title || "Q1 landing page review";
  const showRanking = bool(flags["show-ranking"], true);
  const showThumbnails = bool(flags["show-thumbnails"], true);
  const collectName = choice(flags["collect-name"], ["off", "optional", "required"], "off");
  const collectEmail = choice(flags["collect-email"], ["off", "optional", "required"], "off");
  const provision = await fetchJson(`${apiBase}/api/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientHint: `quorum-cli@${readPackageVersion()}` })
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
      "QUORUM_NOTIFY_EMAIL="
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

function localExport(flags) {
  const payload = {
    generatedAt: new Date().toISOString(),
    note: "Browser local preview data is stored in localStorage. Use the hosted dashboard for production CSV exports."
  };
  fs.writeFileSync("quorum-export.zip", JSON.stringify(payload, null, 2));
  emit(flags, { path: "quorum-export.zip" }, ["Wrote quorum-export.zip"]);
}

function help() {
  console.log(`Quorum

Commands:
  quorum init [--yes] [--title <s>] [--show-ranking <bool>] [--collect-email off|optional|required] [--collect-name off|optional|required] [--show-thumbnails <bool>] [--json]
  quorum dev
  quorum build
  quorum deploy
  quorum export
  quorum dashboard [--json]
`);
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
