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
Sessions are not revocable: `POST /api/blackbox/logout` clears the cookie and
writes an audit entry, but because the cookie is a stateless HMAC token, a client
that keeps sending an old value would still verify until it expires. Revoking
tokens server-side needs a store reachable from the Edge middleware, which is out
of scope for the single-instance local build — rotating
`SCANSITE_ADMIN_PASSWORD` invalidates every session immediately.

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
false-positive verdicts and trusted-file changes (including trust entries that
expired because the hash moved). Collector traffic is *not* logged here — that
volume belongs in the per-site event feed.

The session key only fires when an event actually carries one: the collector
strips any metadata key containing `session` before upload, so today it links
events only if a session identifier arrives under `actor.session`.

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

# LOCAL DEVELOPMENT ONLY. Verification normally refuses to fetch loopback or
# private addresses. Setting this to 1 allows those two classes so you can
# monitor a site running on your own machine. It is never implied by
# NODE_ENV=development, and it never allows link-local (169.254.0.0/16, which
# includes the 169.254.169.254 cloud metadata endpoint) or CGNAT (100.64.0.0/10).
# Leave it unset in production.
SCANSITE_ALLOW_LOCAL_VERIFY=
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
  (10 min gap, 6 h window) **and identity** — actor, IP, session, account,
  plugin, theme, cron hook or touched file path shared inside the window. A privilege escalation
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

### Remediation and verification

An incident also carries a **remediation status**, tracked separately from the
incident status above: an incident can be `confirmed` while its cleanup is still
half done.

`not_started · in_progress · partially_resolved · verified`

`POST /api/blackbox/incidents/:id/verify` re-checks what ScanSite can actually
re-check, and keeps strong evidence separate from weak evidence:

| State | Meaning |
| --- | --- |
| `verified_resolved` | strong evidence — an explicit removal event, a clean integrity scan, an HTTP 200 |
| `likely_resolved` | weaker evidence — absent from a later users snapshot, or a clean aggregate scan |
| `still_present` | evidence the problem is still there |
| `not_verified` | no evidence either way |
| `not_monitored` | ScanSite cannot check this at all; excluded from the totals |

A verification describes a moment. If an event stored **after** it touches the
same account, file path or cron hook — or a new scan reports critical files
again — the stored result is flagged **Needs re-check** and a `verified`
cleanup drops back to `in_progress`.

Every recommendation names the event that caused it (`Reason: account activity
recorded 6 minutes before a suspicious executable appeared…`, `evt_…`), so the
reasoning can be checked in the event log rather than taken on trust.

**Outbound requests.** Verification is the only place ScanSite makes one: a
single GET of a monitored site's own registered origin, to read its HTTP status.
The endpoint accepts no URL — the body is never read — and every request goes
through `lib/blackbox/netguard.js`:

- only the registered canonical origin (scheme + host + port; paths stripped)
- `http`/`https` only — `file:`, `gopher:`, `data:` and friends are rejected
- link-local (incl. `169.254.169.254`) and CGNAT blocked in every environment
- loopback and private ranges blocked unless `SCANSITE_ALLOW_LOCAL_VERIFY=1`
- every DNS answer checked, again inside the socket's own lookup hook, so a
  rebinding answer cannot slip through
- redirects validated before following, never into a blocked range
- 6 s timeout, body never read or returned — only the status code is reported

A blocked check is reported as `not_monitored`, never as a failed website.

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
| `POST /api/blackbox/logout` | Clear the session cookie, write an audit entry |
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
node tests/blackbox/api.mjs           # API contract, hardening, lifecycle, trusted files, file integrity, terminology
node tests/blackbox/scenarios.mjs     # detector + grouping/correlation calibration
node tests/blackbox/dashboard.mjs     # overview priority, website table, event explorer filters, dev diagnostics
node tests/blackbox/remediation.mjs   # likely entry point, guided fix plan, verification round trip
node tests/blackbox/production-render.mjs   # dev vs production render of the incident page (two servers)
```

Four of the five `tests/blackbox` suites need a running server on
`127.0.0.1:3000` (`SCANSITE_URL` overrides) and the admin credentials from the
environment. They create and then delete their own sites.

`remediation.mjs` is the only suite with a unit half: it imports
`classifyEntryPoint` and the remediation helpers straight from `src/lib/blackbox`,
so wording, ordering and confidence regressions fail even when the live half is
skipped. Its live half starts a throwaway HTTP origin so the website-availability
check has a real HTTP 200 to find.

`dashboard.mjs` expects a **development** server, because it asserts the
diagnostics panel is present.

`production-render.mjs` is the exception: it needs the dev server on `:3000`
**and** a production server on `:3100` (`npm run build`, then
`npx next start -H 127.0.0.1 -p 3100`) sharing one data directory. It renders
the same incident on both and asserts that the client components — the guided
fix panel and the verification panel — survive a production build in both of
their states, and that developer diagnostics appear on the dev server and not
on the production one.

#### The real-WordPress lab

`lint.mjs` only proves the collector parses. `tests/wordpress-lab` runs the real
plugin inside a real WordPress on real PHP and watches what it actually delivers:

```bash
cd tests/wordpress-lab
npm install                 # @php-wasm/node
node setup.mjs              # downloads WordPress 6.8.3 + the SQLite drop-in, copies the plugin
node run-all.mjs            # needs the ScanSite dev server on 127.0.0.1:3000
```

`setup.mjs` is idempotent and re-copies `wordpress-plugin/` on every run, so the
lab always tests current source. `wp/`, `wp-sqlite/` and `node_modules/` are
gitignored — they are large and reproducible.

It covers connection and pairing, 27 real event types through a live
`wp_insert_user` / `wp_schedule_event` / file write, queue and retry behaviour,
the admin screen, secret-leak scanning of real payloads, and a final benign
multi-event scenario that must land as one incident with evidence pointing at
real event IDs. Current result: 27/27 event types validated, 0 bugs.

It authenticates with `SCANSITE_ADMIN_USER` / `SCANSITE_ADMIN_PASSWORD` and
removes the lab website both before and after the run — the dashboard's Recent
Activity feed is global, so a lab site left behind pushes other suites' seeded
events out of the window and makes `dashboard.mjs` fail for reasons that have
nothing to do with the collector.

Two probes are opt-in because they are disruptive by design:

```bash
SCANSITE_TEST_RATELIMIT=1 node tests/blackbox/api.mjs   # sends 301 collector requests, expects a 429
SCANSITE_TEST_LOCKOUT=1  node tests/blackbox/api.mjs    # locks the admin login out for 15 minutes
```

`legacy-guruflow/` is archived and excluded from lint; it carries pre-existing
problems that predate this module.
