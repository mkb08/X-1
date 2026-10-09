# TZ Arb Night Desk

A phone-first web app that tests the "timezone arbitrage" idea from
[this post](https://x.com/zakiraicoder/status/2108144884544921783): while U.S. traders sleep, news breaks in
Japan, Asia, Europe, Australia and the Middle East. If a U.S.-accessible prediction market hasn't repriced yet,
the gap might be tradable.

The post's own guide is only sent by DM, so this is an independent build of the mechanism it describes. It
**paper-trades only**, so you can check whether the edge is real before risking money.

## What it does

Every 30 minutes (GitHub Actions → `/api/scan`):

1. **Reads ~19 overseas news feeds**: Japan Times, Nikkei Asia, SCMP, Straits Times, BBC, DW, Guardian, FT,
   Euronews, ABC Australia, SMH, Al Jazeera, The National, Gulf News, and others (`lib/feeds.ts`).
2. **Loads open markets** from Kalshi (CFTC-regulated, U.S.) and Polymarket: about 1,500 liquid markets that
   resolve within your window (`lib/markets.ts`).
3. **Matches headlines to markets** on shared rare terms such as names, places and tickers (`lib/match.ts`).
   This is a cheap pre-filter.
4. **Asks Claude** whether each headline actually moves *that* market, for a calibrated fair probability, and
   whether the price already reflects it (`lib/analyze.ts`, structured JSON output).
5. **Runs the checklist.** A signal is **PASS** only if every check passes:
   - Fresh overseas news (≤ 8h)
   - Liquidity (≥ $500 traded in 24h)
   - Tight spread (≤ 10¢)
   - Resolves soon (≤ 45 days)
   - Directly relevant
   - Not yet repriced
   - Edge ≥ 8¢ (fair value minus the ask you'd pay)
   - Confidence ≥ 60%
6. **Paper-trades PASS signals.** Positions open at the live ask with estimated venue fees, are marked to the live
   bid every scan, and settle automatically when the market resolves.

The app has five tabs: **Desk** (world sessions, gap window, equity curve, scanner), **Signals** (the PASS/DROP
checklist per match), **Trades**, **News**, and **Settings** (all thresholds are editable).

## Deploy (Vercel + GitHub)

1. Import this repo in Vercel (framework: Next.js, no build settings needed).
2. Add environment variables (Project → Settings → Environment Variables):

   | Variable | Required | Notes |
   | --- | --- | --- |
   | `DATABASE_URL` | yes | Neon/Postgres connection string. Tables are created automatically. |
   | `ANTHROPIC_API_KEY` | yes, for AI scoring | Without it, matches show as WATCH and nothing trades. |
   | `ANTHROPIC_WORKSPACE_ID` | only for identity-linked keys | Set it if scans report "not scoped to a workspace". Use a named workspace's `wrkspc_…` ID. |
   | `APP_PASSCODE` | recommended | Locks settings, trades and reset. Enter it once in the app's Settings tab. |
   | `ANALYSIS_MODE` | no | `routine` = score with an hourly Claude Code routine on your subscription (see below). |
   | `ANALYSIS_MODEL` | no | Defaults to `claude-opus-5-5`. |
   | `ANALYSIS_EFFORT` | no | `low` / `medium` (default) / `high`. Lower is cheaper. |
   | `MIN_SCAN_INTERVAL_MIN` | no | Minimum minutes between scans (default 10). Protects your API budget. |

3. Redeploy. If your domain isn't `tz-arb-scanner.vercel.app`, set a GitHub **repository variable** `APP_URL`
   (Settings → Secrets and variables → Actions → Variables) so the scheduled workflow calls the right URL.
4. **If the project uses Vercel Authentication** (Deployment Protection on production), the 30-minute GitHub
   scheduler can't get through until you either:
   - copy Vercel → Project → Settings → Deployment Protection → **Protection Bypass for Automation** into a
     GitHub Actions **secret** named `VERCEL_AUTOMATION_BYPASS_SECRET`; or
   - switch Vercel Authentication to **Standard Protection** (previews only) and set `APP_PASSCODE`.

   The workflow logs a warning with these steps when it gets a 401.

### Run the AI step on a Claude subscription (no API credits)

Set `ANALYSIS_MODE=routine` in Vercel. Scans then stop calling the API and leave new matches as WATCH. A Claude
Code **Routine** (Claude Code on the web → Routines) running every hour does the judging on your subscription:

1. `GET /api/pending?limit=20` (header `x-passcode`) returns unscored matches, the judging instructions, and
   the response format.
2. The routine's Claude session judges each match.
3. `POST /api/evaluations` (same header) stores the judgments. The app re-prices each market, runs the same
   checks, and paper-trades the ones that pass.

Routine prompt (replace `<PASSCODE>`; never commit the real one):

```text
You are the hourly reviewer for the TZ Arb Night Desk paper-trading app at https://tz-arb-scanner.vercel.app.
Your only job is to score pending news/market matches through its API. Do not edit, commit or push files.
1. curl -sS "https://tz-arb-scanner.vercel.app/api/pending?limit=20" -H "x-passcode: <PASSCODE>"
2. If "count" is 0, reply "No pending matches." and stop.
3. Judge every candidate yourself, following "instructions" exactly, with no web browsing.
4. Write /tmp/evaluations.json shaped like "respond_with.body" (one entry per candidate id, all seven
   fields) and POST it to /api/evaluations with the same passcode header and content-type: application/json.
5. Reply in one line: scored / PASS / trades opened from the POST response, or the HTTP error.
```

Routines run at most hourly, so reactions are slower than the API path, and each run uses your plan's Claude
Code usage. To switch back to the API, add credits and delete `ANALYSIS_MODE`.

### Put it on your phone

Open the site in Safari (iPhone) or Chrome (Android) → Share / menu → **Add to Home Screen**. It opens full screen
like an app.

## Cost

These are rough estimates. Only *new* headline/market pairs go to Claude, and each scan is capped by
"Max AI checks per scan" (default 30). Expect roughly **$1–5 per day** on `claude-opus-5-5` at medium effort,
depending on how much news matches. Set `ANALYSIS_EFFORT=low` or lower the cap to spend less. Vercel Hobby,
Neon Free and GitHub Actions on a public repo cost $0.

## Honest caveats

- The post's "$7,625 overnight" figure is unverified, and its video shows a memecoin dashboard rather than this
  strategy. Treat the claim as marketing until your own paper results say otherwise.
- Real news-latency edges are rare and short-lived. Professional market makers watch the same wires. Expect
  most scans to find nothing; that is the honest result.
- Paper fills assume you get the quoted ask with no slippage. Real fills on thin books will be worse.
- Venue access depends on where you live. Polymarket's main exchange restricts U.S. persons, while Kalshi is
  U.S.-regulated. Nothing here places real orders.
- Not financial advice.

## Local development

```bash
cp .env.example .env.local   # fill in DATABASE_URL (+ ANTHROPIC_API_KEY)
npm install
npm run dev                  # http://localhost:3000
curl -X POST localhost:3000/api/scan
```
