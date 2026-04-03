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
| `users.json` | Registered FEDL accounts (hashed passwords) |
| `sessions.json` | Bearer session tokens + expiry |
| `userdata.json` | Per-user synced state (roulette, list %, saved runs, roulette slots) |

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

- **Auth:** Admin Basic (if `ADMIN_PASSWORD` is set)
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

- **Auth:** Admin Basic
- **PUT body:** fields merged via `normalizeRun` with existing run
200 / 404 / 400 as appropriate; emits `runs-update` on success

#### `POST /api/runs/bulk-approve`

- **Auth:** Admin Basic
- **Body:** `{ "playerName": "exact match", "reviewNotes?": "..." }`
- **200:** `{ "ok": true, "approved": number, "playerName": "..." }` — approves all **pending** runs whose `playerName` matches (case-insensitive); may emit `runs-update`

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
- **200:** `{ "userId", "username" }`
- **401:** invalid or expired token

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

### Imports (admin + external APIs)

#### `POST /api/import/pointercrate`

- **Auth:** Admin Basic
- Fetches Pointercrate records, maps to run shape, appends to `runs.json`
- **200:** summary object with counts (see implementation)

#### `POST /api/import/aredl`

- **Auth:** Admin Basic  
- Requires `AREDL_ACCESS_TOKEN` or `AREDL_API_KEY` configured
- **200:** summary / **500** on configuration or API errors

#### `POST /api/import/targeted`

- **Auth:** Admin Basic
- **Body:** `{ "source": "pointercrate" | "aredl", "filter": "player" | "level", "query": "string" }`
- Filters remote records and appends matching runs

## Static files

For **GET** / **HEAD** requests that do not match an API or `/events` handler, the server maps the path (after `BASE` strip) to files under the **repository root** (`../` from `server/`). Default document for `/` is `index.html`.

Unsupported methods receive **405**.

## Options preflight

`OPTIONS` on any path: **204** with CORS headers.
