# GD FEDL

GD FEDL is a Geometry Dash list site built as a multi-page static frontend with a lightweight Node.js backend. It supports live list data, run submissions, admin moderation, account login, synced user state, community posts, bug reports, and direct messages.

## What It Includes

- `index.html` landing page
- `lists.html` ranked list browser with search, filters, and video playback
- `run.html` run submission page
- `admelist.html` admin page for list editing and run moderation
- `players.html` player progress tracker
- `guess.html` rank guessing game
- `roulette.html` demon roulette picker
- `rules.html` rules page
- `signup.html` and `login.html` account pages
- `post.html` and `messages.html` community features
- `contact.html` bug report / contact page
- `errors.html` plus standalone HTTP-style error pages

## Tech Stack

- Plain HTML, CSS, and JavaScript
- No build step for the main site
- Node.js `http` server
- Server-Sent Events for live updates
- Browser `localStorage` / `sessionStorage`
- JSON and text files for simple local persistence

## Project Structure

- `app.js` shared frontend logic
- `styles.css` shared site styling
- `data.txt` static fallback list data
- `level-ids.txt` optional local level ID lookup data for roulette
- `server/server.js` backend for list data, auth, posts, messages, bug reports, and run submissions
- `server/README.md` backend API details
- `server/LINUX_SERVICE_SETUP.txt` example `systemd` setup
- `start-server.command` macOS launcher for the Node server

## Data Files

The main list format is one entry per line:

```txt
category|position|title|url
```

Example:

```txt
new|1|Flamewall|https://youtu.be/x4Io4zkWVRw
```

The server also stores runtime data in `server/`:

- `data.txt` live list source
- `runs.json` submitted runs
- `users.json` registered accounts
- `sessions.json` login sessions
- `userdata.json` synced user state
- `posts.json` community posts
- `bugreports.json` bug reports
- `messages.json` private messages

Most JSON files are created automatically when first needed. `server/data.txt` is the one file you should create yourself before first run.

## Main Backend Features

- `GET /api/list` and `PUT /api/list` for live list data
- `GET /api/runs`, `POST /api/runs`, `PUT /api/runs/:id`, `DELETE /api/runs/:id`
- `POST /api/runs/bulk-approve` for admin moderation
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/user/state`, `PUT /api/user/state` for synced client state
- `GET /api/posts`, `POST /api/posts`, like/comment routes, and post deletion
- `GET /api/bugreports`, `POST /api/bugreports`, admin update/delete routes
- `GET /api/messages`, `POST /api/messages`, conversation lookup, and user search
- `GET /events` for SSE updates
- Pointercrate and AREDL import routes for admins

See [server/README.md](/Users/miles/Documents/GitHub/fedl/server/README.md) for the fuller API reference.

## Local Setup

1. Make sure Node.js is installed.
2. Create the live list data file if it does not exist yet:

```bash
printf "new|1|Example Level|https://youtu.be/example\n" > server/data.txt
```

3. Start the server:

```bash
node server/server.js
```

4. Open the site at:

```txt
http://127.0.0.1:8090/fedl/
```

To expose it on your local network:

```bash
HOST=0.0.0.0 PORT=8090 node server/server.js
```

On macOS you can also run:

```txt
./start-server.command
```

## Environment Variables

- `HOST` server bind host, default `127.0.0.1`
- `PORT` server port, default `8090`
- `ADMIN_PASSWORD` admin password for protected write routes
- `AREDL_ACCESS_TOKEN` bearer token for AREDL imports
- `AREDL_API_KEY` API key for AREDL imports

Example:

```bash
ADMIN_PASSWORD=changeme HOST=0.0.0.0 PORT=8090 node server/server.js
```

## Frontend Live Server Note

`app.js` uses a hardcoded live server base:

```txt
https://raspberrypi-1.tail46eacb.ts.net/fedl
```

That means:

- the frontend will try the remote live server first
- if the live server probe fails, the app redirects to `offlineindex.html`
- if you want local development against your own server, update `TESTING_MODE` or `liveServerBase` in `app.js`

## Notes

- `players.html` stores local player progress in the browser, with optional server sync when signed in
- admin-protected routes use HTTP Basic auth
- account auth uses bearer tokens from the backend
- `roulette.html` can use `level-ids.txt` before falling back to external lookups
- the backend serves the repo root as static files under the `/fedl` base path

## Linux Service

For `systemd` setup notes, see [server/LINUX_SERVICE_SETUP.txt](/Users/miles/Documents/GitHub/fedl/server/LINUX_SERVICE_SETUP.txt).

## License

See [LICENSE](/Users/miles/Documents/GitHub/fedl/LICENSE).
