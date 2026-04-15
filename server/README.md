# FEDL HTTP server

Node.js static file + JSON API server for the FEDL site. It serves the repo root (`../`) as files, exposes REST-style JSON endpoints, and broadcasts **Server-Sent Events (SSE)** when list or run data changes.

## Running

From the **repository root**:

```bash
node server/server.js
```

Or from `server/`:

```bash
node server.js
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8090` | Listen port |
| `HOST` | `127.0.0.1` | Bind address |
| `ADMIN_PASSWORD` | _(empty)_ | If set, **HTTP Basic** password for admin-only routes (username can be anything; password must match) |
| `AREDL_ACCESS_TOKEN` | _(empty)_ | Bearer token for AREDL import APIs |
| `AREDL_API_KEY` | _(empty)_ | API key header for AREDL import APIs |
| `APP_BASE_URL` | _(derived from request)_ | Public site base used in password reset links, for example `https://fedl.site` or `https://server.fedl.site/fedl` |
| `SMTP_HOST` | _(empty)_ | SMTP host for password reset emails |
| `SMTP_PORT` | `465` | SMTP port |
| `SMTP_SECURE` | `true` | Use TLS from connect time; set to `false` only if your mail server accepts plain SMTP |
| `SMTP_USER` | _(empty)_ | SMTP username for authenticated mailboxes |
| `SMTP_PASS` | _(empty)_ | SMTP password |
| `SMTP_FROM` | _(empty)_ | Sender address for password reset emails, e.g. `help@fedl.site` |
| `SMTP_EHLO_NAME` | `fedl.site` | Optional EHLO/HELO name sent to the SMTP server |

Console output shows the effective `PORT`, `HOST`, data paths, and whether admin protection is enabled.

## Base path

All HTTP handling assumes a **URL prefix** of `/fedl`. Incoming paths are normalized: if the request path starts with `/fedl`, that prefix is stripped and the remainder is used for routing and static files.

**Examples** (with defaults, no reverse proxy):

- Site root (often `index.html`): `http://127.0.0.1:8090/fedl` or `http://127.0.0.1:8090/fedl/`
- API list: `http://127.0.0.1:8090/fedl/api/list`
- Events: `http://127.0.0.1:8090/fedl/events`

If you mount the app at a different path in production, change the `BASE` constant in `server.js` to match.

## CORS

Responses to API routes set permissive CORS headers (`Access-Control-Allow-Origin: *`, allowed methods **GET**, **POST**, **PUT**, **DELETE**, **HEAD**, **OPTIONS**, and `Authorization` + `Content-Type` allowed). Browsers may send a preflight **OPTIONS** request; the server answers **204**.

## Data files (under `server/`)

| File | Role |
|------|------|
| `data.txt` | Pipe-separated demon list source (`category\|position\|title\|url` lines) |
| `runs.json` | Run submission queue (moderation) |
| `users.json` | Registered FEDL accounts (hashed passwords + account email) |
| `sessions.json` | Bearer session tokens + expiry |
| `userdata.json` | Per-user synced state (roulette, list %, saved runs, roulette slots) |
| `reset_tokens.json` | One-time password reset tokens + expiry |
| `mods.json` | List of moderator usernames |
| `bugreports.json` | Bug reports submitted via contact form |
| `messages.json` | Private messages between users |
| `config.json` | Server configuration (e.g., Discord webhook URL) |

These files are created on demand where noted below. Use `.gitignore` for `users.json`, `sessions.json`, and `userdata.json` if they contain real data.

## Server-Sent Events

### `GET /events`

- **Response:** `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- **Initial line:** `retry: 3000`
- **Events:** `list-update`, `runs-update` with JSON payloads (e.g. `{ updatedAt: "ISO-8601" }`)

Clients reconnect using the `retry` hint after drops.

## Public JSON API

Unless noted, bodies are **JSON** with `Content-Type: application/json`. Errors use `{ "error": "message" }` when applicable.

### Demon list

#### `GET /api/list`

- **200:** `{ "items": [ { "level", "position", "title", "url" } ], "text": "raw file text" }`
- **500:** could not read `data.txt`

#### `PUT /api/list`

- **Auth:** Admin Basic or Mod Bearer (if `ADMIN_PASSWORD` is set)
- **Body:** `{ "text": "full data.txt content" }`
- **200:** `{ "ok": true }` — writes `data.txt`, emits `list-update`

### Run queue

#### `GET /api/runs`

- **200:** `{ "items": [ run, ... ] }` — each run includes fields from `normalizeRun` (see below)

#### `POST /api/runs`

- **Optional:** `Authorization: Bearer <session-token>` — associates submission with account (`accountUserId`, `accountUsername` on stored run)
- **Body:** `{ "playerName", "levelTitle", "videoUrl", "percent", "rawFootageUrl?", "notes?" }` (required fields enforced server-side)
- **201:** `{ "ok": true, "item": run }`
- **400:** validation / invalid JSON

Run objects include (among others): `id`, `playerName`, `levelTitle`, `videoUrl`, `percent`, `rawFootageUrl`, `notes`, `status`, `reviewedBy`, `reviewNotes`, `submittedAt`, `updatedAt`, `accountUserId`, `accountUsername`.

#### `PUT /api/runs/:id` / `DELETE /api/runs/:id`

- **Auth:** Admin Basic or Mod Bearer
- **PUT body:** fields merged via `normalizeRun` with existing run
200 / 404 / 400 as appropriate; emits `runs-update` on success

#### `POST /api/runs/bulk-approve`

- **Auth:** Admin Basic or Mod Bearer
- **Body:** `{ "playerName": "exact match", "reviewNotes?": "..." }`
- **200:** `{ "ok": true, "approved": number, "playerName": "..." }` — approves all **pending** runs whose `playerName` matches (case-insensitive); may emit `runs-update`

### Mod management

#### `GET /api/mods`

- **Auth:** Mod Bearer
- **200:** `{ "mods": [ "username", ... ] }`

#### `POST /api/mods`

- **Auth:** Mod Bearer
- **Body:** `{ "username": "newmod" }`
- **201:** `{ "ok": true, "mods": [ ... ] }` — adds user to mods list

#### `DELETE /api/mods`

- **Auth:** Mod Bearer
- **Body:** `{ "username": "oldmod" }`
- **200:** `{ "ok": true, "mods": [ ... ] }` — removes user from mods list

#### `GET /api/modcheck`

- **Auth:** Basic or Bearer
- **200:** `{ "isMod": true/false, "username": "..." }` — checks if authenticated user is a mod

### Auth (FEDL user accounts)

#### `POST /api/auth/signup`

- **Body:** `{ "username", "password" }` — username normalized to lowercase; pattern 3–24 chars `[a-z0-9_]`, password min 8 chars
- **201:** `{ "ok": true, "token", "userId", "username" }`
- **400 / 409:** validation or username taken

#### `POST /api/auth/login`

- **Body:** `{ "username", "password" }`
- **200:** `{ "ok": true, "token", "userId", "username" }`
- **401:** invalid credentials

#### `POST /api/auth/logout`

- **Optional:** `Authorization: Bearer <token>` — revokes that session
- **200:** `{ "ok": true }`

#### `GET /api/auth/me`

- **Header:** `Authorization: Bearer <token>`
- **200:** `{ "userId", "username", "email" }`
- **401:** invalid or expired token

#### `POST /api/auth/request-password-reset`

- **Body:** `{ "identifier": "username-or-email" }`
- **200:** generic success response whether or not a matching account exists

#### `POST /api/auth/reset-password`

- **Body:** `{ "token", "newPassword" }`
- **200:** `{ "ok": true }`
- **400:** invalid/expired token or invalid password

### Account settings

#### `GET /api/account`

- **Header:** `Authorization: Bearer <token>`
- **200:** account profile including `username`, `email`, `createdAt`, and whether reset email delivery is configured

#### `PUT /api/account`

- **Header:** `Authorization: Bearer <token>`
- **Body:** `{ "email": "helpful@example.com" }`
- **200:** `{ "ok": true, "email": "..." }`

#### `PUT /api/account/password`

- **Header:** `Authorization: Bearer <token>`
- **Body:** `{ "currentPassword", "newPassword" }`
- **200:** `{ "ok": true, "token": "new-session-token" }`

#### `POST /api/account/password-reset-email`

- **Header:** `Authorization: Bearer <token>`
- Sends a reset link to the email saved on the current account
- Requires SMTP to be configured server-side

### User state (synced client storage)

#### `GET /api/user/state`

- **Header:** `Authorization: Bearer <token>`
- **200:** `{ "data": { "roulettePick", "levelPercents", "savedRuns", "rouletteSlots" } }` — shapes are normalized on read; missing keys default safely
- **401:** not signed in

#### `PUT /api/user/state`

- **Header:** `Authorization: Bearer <token>`
- **Body:** `{ "data": { ...same fields as above... } }` — server sanitizes `savedRuns` and `rouletteSlots` (size limits and field trimming)
- **200:** `{ "ok": true }`
- **401 / 400**
### Bug reports

#### `GET /api/bugreports`

- **Auth:** Admin Basic or Mod Bearer
- **200:** `{ "items": [ bugreport, ... ] }`

#### `POST /api/bugreports`

- **Body:** `{ "category", "subject", "description", "email?" }`
- **201:** `{ "ok": true, "item": bugreport }` — emits `bugreports-update`

#### `PUT /api/bugreports/:id` / `DELETE /api/bugreports/:id`

- **Auth:** Admin Basic or Mod Bearer
- **PUT body:** fields to update (category, subject, description, email, status)
- 200 / 404 / 400; emits `bugreports-update` on success

### Messages

#### `GET /api/messages`

- **Header:** `Authorization: Bearer <token>`
- **200:** `{ "items": [ message, ... ] }` — user's messages

#### `POST /api/messages`

- **Header:** `Authorization: Bearer <token>`
- **Body:** `{ "toUsername", "content" }`
- **201:** `{ "ok": true, "item": message }` — emits `messages-update` to recipient

#### `GET /api/messages/conversation?with=username`

- **Header:** `Authorization: Bearer <token>`
- **200:** `{ "items": [ message, ... ] }` — conversation with specified user

#### `POST /api/messages/search`

- **Header:** `Authorization: Bearer <token>`
- **Body:** `{ "query": "username prefix" }`
- **200:** `{ "items": [ { "username", "userId" }, ... ] }` — user search results
### Imports (admin + external APIs)

#### `POST /api/import/pointercrate`

- **Auth:** Admin Basic or Mod Bearer
- Fetches Pointercrate records, maps to run shape, appends to `runs.json`
- **200:** summary object with counts (see implementation)

#### `POST /api/import/aredl`

- **Auth:** Admin Basic or Mod Bearer
- Requires `AREDL_ACCESS_TOKEN` or `AREDL_API_KEY` configured
- **200:** summary / **500** on configuration or API errors

#### `POST /api/import/targeted`

- **Auth:** Admin Basic or Mod Bearer
- **Body:** `{ "source": "pointercrate" | "aredl", "filter": "player" | "level", "query": "string" }`
- Filters remote records and appends matching runs

## Static files

For **GET** / **HEAD** requests that do not match an API or `/events` handler, the server maps the path (after `BASE` strip) to files under the **repository root** (`../` from `server/`). Default document for `/` is `index.html`.

Unsupported methods receive **405**.

## Options preflight

`OPTIONS` on any path: **204** with CORS headers.
