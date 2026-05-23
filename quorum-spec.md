# Quorum — Lightweight HTML Review Framework

**Status:** Spec (pre-implementation)
**Owner:** Corvo Labs
**Source of extraction:** `freshproof` landing-page feedback flow
**Target repo:** `corvolabs/quorum` (separate from freshproof)

---

## 1. Overview

Quorum is a lightweight, open-source framework for collecting structured feedback on a set of HTML files (and images) from human reviewers. It is the simplest possible tool for:

- **Design feedback** — show N landing-page mocks, capture thumbs up/down + notes, optionally rank a top 1–3.
- **Eval-set seeding for AI projects** — domain experts pass/fail AI-generated HTML artifacts with optional notes, producing CSV ground-truth data.

The narrative for the eval use case: **the simplest way to get your experts writing the first set of evals — pass/fail with a note. That's more than 95% of companies are doing today. Quorum helps them take the first step.**

One tool, one interaction model. The eval positioning is marketing, not a feature fork.

---

## 2. Reviewer Flow

```
Welcome (customizable copy)
   ↓
Sequential review of N options (one at a time)
   - vote: thumbs up / thumbs down
   - optional free-text note
   - autosaved per option
   ↓
[Optional] Ranking screen
   - pick top 1–N (default max 3)
   - thumbnails for images; name+description card for HTML
   - optional overall note
   ↓
Thank You (customizable copy)
```

The pitch/executive-summary stage from freshproof is **cut**.

---

## 3. Operator Flow

```
clone corvolabs/quorum-template
   ↓
npx quorum init   (or pass --yes + flags for agents)
   - hits corvolabs.com to provision project token + retrieval secret
   - writes .env.local and evalbench.config.json (see §7)
   - creates content/welcome.md, content/thankyou.md, content/reviews/
   ↓
drop HTML / image files into content/reviews/
   ↓
edit content/welcome.md and content/thankyou.md
   ↓
npm run build && deploy (Cloudflare Pages is the blessed path)
   ↓
share deployed URL with reviewers
   ↓
visit quorum.corvolabs.com/dashboard/<retrieval-secret> to view + download CSV
```

---

## 4. Tech Stack

- **Frontend:** Vite + React + TypeScript + Tailwind. Static SPA output.
- **Hosted backend (Corvo Labs):** Cloudflare Workers + D1 + (optional) Email Workers.
- **Provisioning + dashboard:** part of the same Worker, served from `quorum.corvolabs.com`.

Vite chosen over Next.js: no SSR needs, lighter dep tree, static output deploys anywhere.

---

## 5. Repo Structure

Two repos:

1. **`corvolabs/quorum`** (public, MIT) — the template users clone. Vite app + `bin/quorum.js` CLI + docs.
2. **`corvolabs/quorum-server`** (private or source-available) — the Cloudflare Worker, D1 schema, dashboard UI.

No separate npm CLI package in v1; the CLI lives in the template repo and is invoked via `npx quorum <cmd>` after install (or directly via `node bin/quorum.js`).

License: **MIT**.

---

## 6. URL Layout

Single subdomain. Both API and dashboard live under `quorum.corvolabs.com`:

- `POST quorum.corvolabs.com/api/provision` — issue a new project
- `POST quorum.corvolabs.com/api/sessions` — create reviewer session
- `POST quorum.corvolabs.com/api/responses` — upsert vote/note
- `POST quorum.corvolabs.com/api/rankings` — upsert ranking
- `POST quorum.corvolabs.com/api/complete` — mark session complete
- `GET  quorum.corvolabs.com/dashboard/:retrievalSecret` — operator dashboard
- `GET  quorum.corvolabs.com/dashboard/:retrievalSecret/export.zip` — CSV download

---

## 7. Configuration Surface

Three locations, each with a clear purpose.

### 7.1 `.env.local` — secrets only

```
QUORUM_PROJECT_TOKEN=qpt_<base64url-32-bytes>
QUORUM_STORAGE_ADAPTER=corvo            # corvo | local-sqlite
QUORUM_NOTIFY_EMAIL=                     # optional, opt-in daily digest
```

### 7.2 `quorum.config.json` — behavior toggles (agent-friendly)

```json
{
  "title": "Q1 landing page review",
  "showRanking": true,
  "maxRankingPicks": 3,
  "collectName": "off",                  // off | optional | required
  "collectEmail": "off",                 // off | optional | required
  "showThumbnails": true,
  "reviewsDir": "./content/reviews",
  "hideBranding": false,
  "unsafeAllowSameOrigin": false
}
```

### 7.3 Content files — long-form copy

- `content/welcome.md` — freeform markdown, renders into a centered card. The "Start Reviewing" CTA button is framework-controlled; its label is `welcome.cta` in config (or defaults to "Start Reviewing").
- `content/thankyou.md` — same shape, post-completion.
- `content/reviews/` — the files to be reviewed (see §8).

The framework controls the page layout/chrome; markdown controls the message.

---

## 8. Review Content

### 8.1 Supported file types (v1)

- `.html` — rendered in `<iframe src="...">` (NOT `srcDoc`) so relative asset paths resolve.
- `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` — rendered via `<img>` tag, centered, max-height viewport.

PDF and Markdown rendering deferred to v2.

### 8.2 Ordering

Pure alphanumeric sort of filenames. A `01-` numeric prefix naturally sorts ahead of `02-`. No manifest file needed. Files can mix types freely.

### 8.3 Display names

Derived from filename: strip leading numeric prefix and extension, replace hyphens/underscores with spaces, title-case.

- `01-modern-editorial.html` → "Modern Editorial"
- `02-hero_v2.png` → "Hero V2"

No per-file display-name config in v1.

### 8.4 Asset references

Files are served as static assets from `content/reviews/` (publicly routable). HTML files may reference sibling assets via relative paths. Operator is responsible for keeping assets co-located.

### 8.5 HTML sandbox

Default iframe sandbox: `allow-scripts` only.

To enable `allow-same-origin` (needed for files that fetch external resources or use storage APIs), set `unsafeAllowSameOrigin: true` in config. Default is the safer setting.

### 8.6 Thumbnails on ranking screen

- For image files: the file itself is used as its thumbnail (`object-fit: cover`).
- For HTML files: shown as a text card with name + optional description.
- If a sibling `.png` exists next to the HTML file (e.g. `01-foo.html` + `01-foo.png`), it is preferred as the thumbnail.

No screenshot pipeline. No required thumbnail authoring step.

---

## 9. Reviewer Identity

- Per-browser anonymous UUID stored in cookie (`quorum_session`, 30d) + localStorage fallback. Same browser resumes; new browser/incognito starts fresh.
- `collectName` and `collectEmail` config govern whether the welcome screen asks for them (`off` / `optional` / `required`). When `required`, the Start button is disabled until the field is filled.

---

## 10. Data Model

### 10.1 Storage Adapter Interface

The framework ships with two adapters behind a 4-method interface:

```ts
interface StorageAdapter {
  createSession(input: { projectToken: string; anonymousId: string; name?: string; email?: string }): Promise<{ sessionId: string }>;
  saveResponse(input: { sessionId: string; optionId: string; vote?: 'up' | 'down'; note?: string }): Promise<void>;
  saveRanking(input: { sessionId: string; picks: string[]; overallNote?: string }): Promise<void>;
  completeSession(sessionId: string): Promise<void>;
}
```

Adapters in v1:

- `CorvoCloudAdapter` (default) — POSTs to `quorum.corvolabs.com/api/*`.
- `LocalSqliteAdapter` — writes to a local SQLite file. For self-hosters. The dashboard/export logic is duplicated as a local CLI: `npx quorum export > data.zip`.

Selected via `QUORUM_STORAGE_ADAPTER` env var.

### 10.2 Corvo D1 Schema

```sql
CREATE TABLE projects (
  token TEXT PRIMARY KEY,                -- qpt_<32 bytes base64url>
  retrieval_secret_hash TEXT NOT NULL,    -- scrypt/argon2 hash of qrs_*
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  response_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_token TEXT NOT NULL REFERENCES projects(token),
  anonymous_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  option_id TEXT NOT NULL,
  vote TEXT,                              -- 'up' | 'down' | null
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, option_id)
);

CREATE TABLE rankings (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  picks_json TEXT NOT NULL,               -- JSON array of option_ids in order
  overall_note TEXT,
  updated_at INTEGER NOT NULL
);
```

---

## 11. Provisioning

```
POST quorum.corvolabs.com/api/provision
Body: { "clientHint": "quorum-cli@0.1.0" }
Response: {
  "projectToken":   "qpt_...",   // shown only at provision time
  "retrievalSecret": "qrs_...",   // shown only at provision time
  "dashboardUrl":   "https://quorum.corvolabs.com/dashboard/qrs_...",
  "createdAt":      <unix-seconds>
}
```

- No auth required to call provision. Abuse limited by IP rate-limiting + (optional) Turnstile.
- Project token and retrieval secret are 32-byte random base64url.
- Retrieval secret is hashed before storage; the plaintext is shown to the operator exactly once.
- Project token persists indefinitely while project has activity in the last 90 days.

---

## 12. Retention & Abuse Controls

- **Data retention:** per-response, 7 days from `responses.updated_at`. A daily cron purges expired rows.
- **Project retention:** projects with no submissions for 90 days are purged entirely.
- **Rate limits (per project token):** 100 submissions/hour.
- **Rate limits (per retrieval secret):** 10 retrievals/hour.
- **Hard cap:** 1000 total responses per project per rolling 7-day window. On hit, API returns 429 with a clear message and a contact link.
- **Captcha:** Cloudflare Turnstile on `/api/sessions` (session creation), invisible by default.

---

## 13. Dashboard

`GET quorum.corvolabs.com/dashboard/:retrievalSecret`

Minimal live view:

- Project token (last 6 chars), provisioned date, days until next purge.
- Total sessions started / completed.
- Per-option up/down counts.
- Current ranking tally (count of times each option was picked 1st / 2nd / 3rd).
- "Download CSV" button → ZIP export.
- "Completed only" toggle that affects both the on-page view and the download.

No charts. No filtering beyond completed/all. Implementation target: under ~200 LOC.

---

## 14. CSV Export

`GET quorum.corvolabs.com/dashboard/:retrievalSecret/export.zip` returns a ZIP containing:

- `summary.csv` — one row per reviewer, wide format:
  ```
  session_id, name, email, started_at, completed_at, completed,
  option_01_vote, option_01_note, option_02_vote, option_02_note, ...,
  ranking_1st, ranking_2nd, ranking_3rd, overall_note
  ```
- `sessions.csv` — `session_id, anonymous_id, name, email, started_at, completed_at`
- `votes.csv` — `session_id, option_id, vote, note, created_at, updated_at`
- `rankings.csv` — `session_id, pick_position, option_id, overall_note, updated_at`

UTF-8 CSV, no XLSX/JSON in v1. Incomplete sessions included by default.

---

## 15. CLI

The template ships a CLI at `bin/quorum.js`. Every interactive prompt has a corresponding flag for agent use. A `--json` global flag emits machine-readable output. A `--yes` flag accepts all defaults.

### Commands

- `quorum init [--yes] [--title <s>] [--show-ranking <bool>] [--collect-email <off|optional|required>] [--collect-name <off|optional|required>] [--show-thumbnails <bool>] [--json]`
  Provisions project, writes `.env.local` + `quorum.config.json`, scaffolds `content/`.

- `quorum dev` — alias for `vite dev`.

- `quorum build` — alias for `vite build`.

- `quorum deploy` — alias for `wrangler pages deploy dist` (Cloudflare Pages blessed path).

- `quorum export` — only meaningful for the `local-sqlite` adapter; produces a ZIP at `./quorum-export.zip`.

- `quorum dashboard` — prints the dashboard URL from `.env.local` (handy for agents).

---

## 16. Notifications

Opt-in via `QUORUM_NOTIFY_EMAIL=<address>` in `.env.local`.

When set: Corvo's Email Worker sends a once-daily digest listing newly completed sessions in the last 24h and a deep link to the dashboard. No per-submission emails.

If unset: no email is sent. Ever. The dashboard URL is the only access path.

---

## 17. Branding

Reviewer-facing pages include a subtle footer: "Powered by Quorum · Corvo Labs" with a link. Removable via `hideBranding: true` in `quorum.config.json`.

---

## 18. Deploy Targets

**Blessed path:** Cloudflare Pages. The CLI's `quorum deploy` wraps `wrangler pages deploy dist`. Pairs cleanly with the Corvo backend on the same vendor's free tier.

**Documented alternatives:** Vercel, Netlify, GitHub Pages, any static host. Build output is plain `dist/` from Vite.

---

## 19. Mobile Support

Responsive but desktop-optimized. The review UI (welcome, vote, note, ranking, thank-you) works on mobile. Rendering arbitrary HTML files at mobile widths depends on whether the source files are themselves responsive — Quorum makes no guarantees there. README states "best on desktop."

---

## 20. v1 Non-Goals

Explicit cuts to keep scope tight:

- No reviewer auth/accounts.
- No multi-operator collaboration (one project = one retrieval secret).
- No live updates to running reviews; changes require redeploy.
- No scoring beyond thumbs up/down (no stars, no tags, no rubrics).
- No reviewer assignment ("Alice does 1–3, Bob does 4–6").
- No webhooks or integrations.
- No file versioning.
- No PDF/markdown rendering of review content.
- No comparative/side-by-side view.
- No XLSX or JSON export (CSV only).
- No per-submission email; no SMS; no Slack.
- No per-file display-name config; names derived from filenames.

---

## 21. Open Questions / Deferred

- Whether `quorum-server` is fully open-sourced at launch or kept source-available.
- Local SQLite adapter dashboard: do we ship a local `quorum dashboard --serve` web UI, or only CLI export? (Lean: CLI export only for v1.)
- Turnstile threshold tuning.
- Whether to support a per-project custom-domain dashboard at v2.

---

## 22. Implementation Phases (suggested ordering)

1. **Backend foundation** — CF Worker, D1 schema, provision/session/response/ranking/complete endpoints, Turnstile.
2. **Template skeleton** — Vite + React app with the StorageAdapter interface and CorvoCloudAdapter.
3. **Reviewer flow** — welcome → review → ranking → thank-you, with markdown CMS.
4. **Dashboard + export** — Worker-rendered dashboard, ZIP export.
5. **CLI + init flow** — provision wiring, config scaffolding, agent flags.
6. **LocalSqliteAdapter + `quorum export`** — self-host path.
7. **Notifications** — daily digest Email Worker.
8. **Polish** — branding toggle, sandbox flag, README, agent quickstart docs.
