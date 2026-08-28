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
The transformation from four raw events into *"Suspicious executable after
privilege escalation — risk 100, confidence 77%"* is the product.

**Language discipline.** ScanSite reports what it can prove. It says *"suspicious
file"*, *"unexpected executable"* and *"possible compromise"* — never *"malware
confirmed"*, *"webshell detected"* or *"backdoor planted"*. Nothing here reads
file contents or executes them, so a source-level verdict is never claimed;
the file page states *"Source code analysis: Not performed"* for exactly that
reason.

**Risk and confidence are separate numbers.** Risk is how serious the outcome
would be. Confidence is how strong the evidence is. A serious finding with thin
evidence is allowed to read `risk 95 / confidence 25`.

---

## Quick start

```bash
npm install
SCANSITE_ADMIN_USER=admin SCANSITE_ADMIN_PASSWORD=change-me npm run dev
```

Open `http://localhost:3000`, sign in, then **+ Add Website** → follow the
five-step wizard to pair a real WordPress site and start receiving events.

Without `SCANSITE_ADMIN_PASSWORD` the dashboard stays locked and `/login`
explains what to set. No database, no auth provider, no CMS, no external AI
service. Data is stored as JSON under `data/blackbox/` (git-ignored).

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

### Access control

Two independent gates, both mandatory.

**1. Dashboard — a single local administrator.** There are no accounts, no
external provider and no sign-up. Configure the admin through the environment;
every page and every management API then requires a valid session cookie
(`scansite_session`, HMAC, 7 days). When no password is configured the
dashboard fails **closed**: pages redirect to `/login`, APIs return `401`.
Sessions are not revocable — they expire, or the password changes.

**2. Collector — per-site key plus a required HMAC signature.** Every collector
request must carry:

```text
X-ScanSite-Site:      site_8c72fa
X-ScanSite-Key:       sk_bb_…            (compared as SHA-256, constant-time)
X-ScanSite-Timestamp: 1756300000         (must be within 5 minutes)
X-ScanSite-Nonce:     32-hex random      (single use inside the skew window)
X-ScanSite-Signature: sha256=HMAC(key, timestamp + "." + nonce + "." + body)
```

Only the SHA-256 of a collector key is stored server-side, so leaking the data
directory does not leak usable credentials. Keys are never sent in a query
string, never returned by `GET`, and are shown once at issue/rotation. A site
whose key was rotated or revoked is rejected; a deliberately disconnected site
gets `403` rather than a credential error.

### Hardening

| Protection | Limit | Response |
| --- | --- | --- |
| Request body size | 1 MB (`MAX_BODY_BYTES`) | `413` |
| String fields (path, actor, IP, metadata strings) | 2 000 chars | truncated on ingest |
| Metadata depth / array length / object keys | 4 levels · 100 items · 100 keys | truncated on ingest |
| Collector request rate | 300 requests / 5 min per site | `429` |
| Failed dashboard logins | 5 per source, then 15 min lock | `429` |

Rate limiting and the login lockout are **in-memory and per process** — correct
for the single-instance local deployment this targets, and the wrong tool for a
multi-instance one (swap `src/lib/blackbox/ratelimit.js` for a shared store).
A restart clears both counters.

### Audit log

Administrative actions on this ScanSite instance are appended to
`data/blackbox/audit.json` (capped at 2 000 entries) and shown under
**Settings → Management audit log**: admin sign-in and failures, website
add/delete, disconnect/reconnect, key rotation, incident status changes,
false-positive verdicts and trusted-file changes. Collector traffic is *not*
logged here — that volume belongs in the per-site event feed.

### Trusted files

A file can be trusted by **path + SHA-256** (`POST
/api/blackbox/sites/[id]/files/trusted`). While the hash matches, the file is
reported as verified and its risk is held down. The moment the hash changes the
trust entry expires automatically and the file returns to normal integrity
handling — trust never survives a content change.

### Environment

```bash
# MANDATORY: the local administrator. Without a password the dashboard is
# locked and /login explains how to configure it.
SCANSITE_ADMIN_USER=admin
SCANSITE_ADMIN_PASSWORD=change-me

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

- **Grouping** — events for one site are clustered by *two* links: silence
  (10 min gap, 6 h window) **and identity** — actor, IP, account, plugin,
  theme, cron hook or target shared inside the window. A privilege escalation
  and the executable that appeared 45 minutes later land in one incident
  because the same account did both. When events carry no correlation keys the
  time link is the only one that can fire, so behaviour degrades to plain
  time-based grouping.
- **Scoring** — per-event points, anchored onto a 0–100 risk score. The raw
  internal score is kept alongside it.
- **Detectors** — privilege escalation → suspicious executable, unexpected
  executable in uploads, unexpected administrator, update/install → breakage,
  traffic/mail hijacking, persistence, brute force, config tampering, routine
  maintenance.
- **Correlation** — events are linked by actor, IP, plugin, account and hook,
  not just timing. That is what turns "an admin was created" and "a PHP file
  appeared" into one story.
- **Confidence** — starts from how strongly the leading pattern matched, then
  rises with corroborating events, events tied to the same actor/IP/target, and
  a tight burst; falls when a competitor pattern is nearly as strong or the
  window is too thin to read. It is never merged into the risk number.
- **Concepts** — cause / change / persistence / impact are reported separately.
- **Evidence** — every conclusion cites real stored event IDs.
- **Recommendations** — immediate / investigate / recovery. ScanSite never
  modifies a website.

Severity bands: `0–19 INFO · 20–39 LOW · 40–59 MEDIUM · 60–79 HIGH · 80–100 CRITICAL`.

### Incident lifecycle

`new · investigating · confirmed · false_positive · remediated · monitoring ·
resolved`

An incident carries an append-only **notes** log (what you checked, what you
ruled out) and marking one a false positive **requires a reason** — a verdict
without a reason is worthless the next time the same alert fires.

---

## API

### Collector-facing (site key + HMAC signature required)

| Route | Purpose |
| --- | --- |
| `POST /api/blackbox/connect` | Redeem a pairing code, issue the collector key |
| `POST /api/blackbox/verify` | Accept the collector self-test event |
| `POST /api/blackbox/heartbeat` | Update `lastSeenAt`, deliver pending commands (e.g. key rotation) |
| `POST /api/blackbox/ingest` | Accept a batch of up to 100 events |
| `POST /api/blackbox/rotate` | Accept a new collector key generated by the plugin (authenticated with the current key; only the SHA-256 is stored) |

### Dashboard-facing (admin session required)

| Route | Purpose |
| --- | --- |
| `POST /api/blackbox/login` | Start an admin session (`429` while locked out) |
| `GET`/`POST /api/blackbox/sites` | List websites / register one + pairing code |
| `GET`/`PATCH`/`DELETE /api/blackbox/sites/[id]` | Detail, rename, delete (`?purge=true`) |
| `POST /api/blackbox/sites/[id]/disconnect` | Stop accepting events, revoke key |
| `POST /api/blackbox/sites/[id]/reconnect` | Issue a fresh pairing code |
| `POST /api/blackbox/sites/[id]/rotate-key` | New collector key, returned once |
| `POST /api/blackbox/sites/[id]/verify` | Confirm a test event actually landed |
| `GET /api/blackbox/sites/[id]/files` | File-integrity records + aggregates |
| `GET /api/blackbox/sites/[id]/files/[fileId]` | One file's integrity record |
| `POST /api/blackbox/sites/[id]/files/scan` | Queue a quick or deep collector scan |
| `GET`/`POST`/`DELETE /api/blackbox/sites/[id]/files/trusted` | Manage path + SHA-256 trust entries |
| `GET /api/blackbox/incidents` | List with `site`/`severity`/`status`/`category`/`from`/`q` filters |
| `GET`/`PATCH /api/blackbox/incidents/[id]` | Detail / status, notes, false-positive reason |
| `GET /api/blackbox/events` | Raw event feed |
| `GET /api/blackbox/audit` | Local management audit trail |
| `GET /api/blackbox/collector/download` | Serve the collector plugin ZIP |

Every route not listed as collector-facing is behind the session middleware; an
unauthenticated API call gets `401`, not a redirect.

---

## Layout

```text
src/lib/blackbox/     storage, sites, connection, auth (collector HMAC),
                      gate (local admin session), ratelimit, schemas, grouping,
                      analyzer, scoring, confidence, correlation,
                      recommendations, detectors/, files/, ingest, dashboard
src/app/(scansite)/   /  /websites  /websites/add  /websites/[id]
                      /websites/[id]/events  /websites/[id]/files
                      /websites/[id]/files/[fileId]  /incidents  /incidents/[id]
                      /events  /files  /connection  /environment  /settings
src/app/api/blackbox/ the routes above
src/app/components/blackbox/  UI
wordpress-plugin/scansite-blackbox-collector/  the WordPress collector
legacy-guruflow/      archived pre-Black-Box code, excluded from the build
```

Only `src/lib/blackbox/storage.js` touches persistence, so the JSON driver can
be replaced with PostgreSQL without changing the analysis engine or the UI.
Writes go to a temp file and are renamed into place, and the previous JSON is
kept as a `.bak` beside it, so a torn write cannot destroy the store. If the
filesystem turns out to be read-only the driver falls back to memory and says
so loudly: `storageInfo().warning` is surfaced in the API and on the Settings
page rather than silently losing data on restart.

---

## Development

```bash
npm run build   # production build
npm run lint    # eslint over the live source
```

### Tests

```bash
node tests/wordpress-lab/lint.mjs     # real PHP 8.0–8.4 syntax check of the collector (php-wasm)
node tests/blackbox/api.mjs           # API contract + hardening suite
node tests/blackbox/scenarios.mjs     # detector/grouping calibration
```

The two `tests/blackbox` suites need a running server on `127.0.0.1:3000`
(`SCANSITE_URL` overrides) and the admin credentials from the environment.
They create and then delete their own sites.

Two probes are opt-in because they are disruptive by design:

```bash
SCANSITE_TEST_RATELIMIT=1 node tests/blackbox/api.mjs   # sends 301 collector requests, expects a 429
SCANSITE_TEST_LOCKOUT=1  node tests/blackbox/api.mjs    # locks the admin login out for 15 minutes
```

`legacy-guruflow/` is archived and excluded from lint; it carries pre-existing
problems that predate this module.
