# Quorum

Quorum is a lightweight review framework for collecting structured human feedback on HTML files and images. Reviewers move through a simple pass/fail flow with notes and an optional ranking step; operators download CSV output from the hosted Corvo Labs dashboard.

## Quickstart

```bash
npm install
npx quorum init --yes --title "Landing page review"
cp .env.local .env
npm run dev
```

Drop `.html`, `.png`, `.jpg`, `.jpeg`, `.webp`, or `.svg` files into `content/reviews/`. Filenames sort alphanumerically and become display names automatically, so `01-modern-editorial.html` appears as `Modern Editorial`.

## Deploy

```bash
npm run build
npx quorum deploy
```

The blessed production target is Cloudflare Pages. The build output is plain `dist/`, so Vercel, Netlify, GitHub Pages, and other static hosts also work.

## Configuration

Secrets live in `.env.local`:

```bash
VITE_QUORUM_PROJECT_TOKEN=qpt_...
VITE_QUORUM_STORAGE_ADAPTER=corvo
QUORUM_DASHBOARD_URL=https://quorum.corvolabs.com/dashboard/qrs_...
QUORUM_NOTIFY_EMAIL=
```

Reviewer behavior lives in `quorum.config.json`, which is intentionally JSON so agents can edit it safely.

## Dashboard

Run:

```bash
npx quorum dashboard
```

The dashboard URL includes the retrieval secret and is shown once during provisioning. Store it like a password.

## License

MIT
