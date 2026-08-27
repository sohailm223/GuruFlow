# ScanSite Black Box

**Know exactly what happened to your website.**

ScanSite Black Box connects to WordPress websites, records the changes that
matter, and turns raw activity into explained incidents: what changed, when,
what probably caused it, what it broke, and what to do next.

```text
WordPress Website → ScanSite Collector → Secure Connection → Raw Events
  → Correlation → Incident Grouping → Pattern Detection → Risk Scoring
  → Likely Cause → Evidence → Impact → Recommended Response
```

This is not an activity log, not a malware scanner, and not uptime monitoring.
The transformation from five raw events into *"Backdoor planted after privilege
escalation, confidence 94%"* is the product.

---

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` → **+ Add Website** → follow the five-step wizard.

To see the analysis engine without a WordPress site, use **Generate Demo
Incidents** on the Overview page (development builds only), or:

```bash
curl -X POST http://localhost:3000/api/blackbox/demo
```

No database, no auth provider, no CMS, no external AI service. Data is stored
as JSON under `data/blackbox/`.

---

## Connecting a WordPress website

1. **Add Website** — enter a name and URL. ScanSite creates a site record and a
   short pairing code (e.g. `K8F3-PQ9X`), valid for 30 minutes, single use.
2. **Install the collector** — download the plugin ZIP from the wizard (served
   from `wordpress-plugin/` by `/api/blackbox/collector/download`) or install it
   manually.
3. **Connect** — in WordPress go to *ScanSite → Black Box*, paste the code and
   the ScanSite URL. The plugin exchanges the code for a permanent collector
   key, shown once.
4. **Verify** — the collector sends a test event; the dashboard confirms it
   actually arrived.
5. **Monitor** — events arrive in batches from WP-Cron.

### Credentials

| Secret | Lifetime | Where |
| --- | --- | --- |
| Connection code | 30 min, single use | typed by a human |
| Collector key | permanent until rotated | stored in `wp_options`; only its SHA-256 is kept server-side |

Every collector request carries `X-ScanSite-Site` and `X-ScanSite-Key` headers —
never credentials in a query string. Comparison is constant-time. A site whose
key has been rotated or revoked is rejected; a deliberately disconnected site
gets `403` rather than a credential error.

HMAC request signing is implemented and isolated in
`src/lib/blackbox/auth.js` / `includes/class-signing.php`
(`X-ScanSite-Timestamp` + `X-ScanSite-Signature`, `sha256=HMAC(timestamp + "." + body, key)`).
It activates when the collector starts sending those headers; no route changes
are needed.

### Environment

```bash
# Where the collector should send events. Leave unset to derive it from the
# request the user made, so a LAN address or dev tunnel works unchanged.
NEXT_PUBLIC_SCANSITE_BASE_URL=http://localhost:3000

# Optional: override the JSON store location.
BLACKBOX_DATA_DIR=
```

A remote WordPress host usually cannot reach `localhost`. Point the plugin at a
LAN address, tunnel or staging URL instead.

---

## What is monitored

`core` · `plugin` · `theme` · `file` · `db` · `user` · `cron` · `config`
(`.htaccess`, `wp-config.php`) · `redirect` · `auth` · `smtp`

`dns` and `ssl` remain in the schema but are **not monitored by the collector
yet** — the UI labels them as such rather than showing fake results. They are
intended to be checked server-side later.

The collector never sends passwords, salts, cookies, SMTP credentials, API
secrets, or form contents. Metadata only.

---

## Analysis

Deterministic — rules, patterns, event scoring, correlation and confidence. No
AI service is called.

- **Grouping** — events for one site split into incidents by silence (10 min gap,
  6 h window).
- **Scoring** — per-event points, anchored onto a 0–100 risk score. The raw
  internal score is kept alongside it.
- **Detectors** — seven patterns: privilege escalation → backdoor, webshell
  upload, unexpected administrator, update/install → breakage, traffic/mail
  hijacking, persistence, brute force, config tampering, routine maintenance.
- **Correlation** — events are linked by actor, IP, plugin, account and hook,
  not just timing. That is what turns "an admin was created" and "a PHP file
  appeared" into one story.
- **Concepts** — cause / change / persistence / impact are reported separately.
- **Evidence** — every conclusion cites real stored event IDs.
- **Recommendations** — immediate / investigate / recovery. ScanSite never
  modifies a website.

Severity bands: `0–19 INFO · 20–39 LOW · 40–59 MEDIUM · 60–79 HIGH · 80–100 CRITICAL`.

---

## API

### Collector-facing (header-authenticated)

| Route | Purpose |
| --- | --- |
| `POST /api/blackbox/connect` | Redeem a pairing code, issue the collector key |
| `POST /api/blackbox/verify` | Accept the collector self-test event |
| `POST /api/blackbox/heartbeat` | Update `lastSeenAt` |
| `POST /api/blackbox/ingest` | Accept a batch of up to 100 events |

### Dashboard-facing

| Route | Purpose |
| --- | --- |
| `GET`/`POST /api/blackbox/sites` | List websites / register one + pairing code |
| `GET`/`PATCH`/`DELETE /api/blackbox/sites/[id]` | Detail, rename, delete (`?purge=true`) |
| `POST /api/blackbox/sites/[id]/disconnect` | Stop accepting events, revoke key |
| `POST /api/blackbox/sites/[id]/reconnect` | Issue a fresh pairing code |
| `POST /api/blackbox/sites/[id]/rotate-key` | New collector key, returned once |
| `POST /api/blackbox/sites/[id]/verify` | Confirm a test event actually landed |
| `GET /api/blackbox/incidents` | List with `site`/`severity`/`status`/`category`/`from`/`q` filters |
| `GET`/`PATCH /api/blackbox/incidents/[id]` | Detail / change status |
| `GET /api/blackbox/events` | Raw event feed |
| `GET`/`POST /api/blackbox/demo` | Load the reference scenario |
| `GET /api/blackbox/collector/download` | Serve the collector plugin ZIP |

Incident statuses: `new · investigating · confirmed · false_positive ·
remediated · monitoring · resolved`.

---

## Layout

```text
src/lib/blackbox/     storage, sites, connection, auth, schemas, grouping,
                      analyzer, scoring, confidence, correlation,
                      recommendations, detectors/, ingest, dashboard, demo
src/app/(scansite)/   /  /websites  /websites/add  /websites/[id]
                      /incidents  /incidents/[id]
src/app/api/blackbox/ the routes above
src/app/components/blackbox/  UI
wordpress-plugin/scansite-blackbox-collector/  the WordPress collector
legacy-guruflow/      archived pre-Black-Box code, excluded from the build
```

Only `src/lib/blackbox/storage.js` touches persistence, so the JSON driver can
be replaced with PostgreSQL without changing the analysis engine or the UI.

---

## Development

```bash
npm run build   # production build
npm run lint    # eslint over the live source
```

`legacy-guruflow/` is archived and excluded from lint; it carries pre-existing
problems that predate this module.
