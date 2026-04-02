# GD FEDL

GD FEDL is a small multi-page Geometry Dash list site with a static frontend and a lightweight Node.js backend for live list data, run submissions, and admin moderation.

## What It Includes

- `index.html` landing page with live list stats and featured entries
- `lists.html` ranked list browser with search, range filters, and video modal playback
- `run.html` run submission form with a live submission queue
- `admelist.html` admin panel for editing the list and reviewing submitted runs
- `guess.html` rank guessing game
- `roulette.html` demon roulette picker with level ID lookups
- `rules.html` submission and moderation rules
- `players.html` browser-local player tracker
- `errors.html` plus individual HTTP-style error pages

## Tech Stack

- Plain HTML, CSS, and JavaScript
- No build step
- Node.js `http` server
- Server-Sent Events for live updates
- Browser `localStorage` / `sessionStorage` for local state

## Project Structure

- `index.html` main landing page
- `lists.html` live list page
- `run.html` run submission page
- `admelist.html` admin page
- `guess.html` guessing game
- `roulette.html` roulette page
- `players.html` local player manager
- `rules.html` rules page
- `errors.html` error page gallery
- `401.html`, `403.html`, `404.html`, `429.html`, `500.html`, `502.html`, `503.html` standalone error pages
- `app.js` shared frontend logic for all pages
- `styles.css` shared site styling
- `data.txt` static fallback list data
- `level-ids.txt` optional local level ID lookup data for roulette
- `server/server.js` backend for list data, run submissions, auth, and live events
- `server/LINUX_SERVICE_SETUP.txt` example `systemd` setup notes
- `start-server.command` macOS launcher for the Node server

## Data Format

The list data file uses one entry per line in this format:

```txt
category|position|title|url
```

Example:

```txt
new|1|Flamewall|https://youtu.be/x4Io4zkWVRw
```

The frontend parses that into:

- `level` / category
- `position`
- `title`
- `url`

## Backend API

The Node server exposes these routes:

- `GET /api/list` returns the live list
- `PUT /api/list` replaces the live list data
- `GET /api/runs` returns submitted runs
- `POST /api/runs` creates a run submission
- `PUT /api/runs/:id` updates a submission
- `DELETE /api/runs/:id` deletes a submission
- `GET /events` streams `list-update` and `runs-update` events

If `ADMIN_PASSWORD` is set, list editing and run moderation routes require HTTP Basic auth.

## Local Setup

1. Make sure Node.js is installed.
2. Create the server data files if they do not exist yet:

```bash
printf "new|1|Example Level|https://youtu.be/example\n" > server/data.txt
printf "[]\n" > server/runs.json
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

## Important Frontend Note

`app.js` currently uses this hardcoded live server base:

```txt
https://raspberrypi-1.tail46eacb.ts.net/fedl
```

That means:

- when the site is opened over `http` or `https`, the frontend will try that remote live server first
- when the site is opened directly from disk with `file://`, it falls back to local `data.txt`
- if you want the frontend to use your own local Node server as the primary live backend, update `liveServerBase` in `app.js`

## Fallback Behavior

List loading tries these sources in order:

1. Remote live API: `/api/list`
2. Remote live data file: `/server/data.txt`
3. Local `data.txt`

Run data comes from the live runs API when available. If the live backend is unavailable, run submissions and moderation will not work.

## Environment Variables

- `HOST` server bind host, default `127.0.0.1`
- `PORT` server port, default `8090`
- `ADMIN_PASSWORD` optional admin password for protected write actions

Example:

```bash
ADMIN_PASSWORD=changeme HOST=0.0.0.0 PORT=8090 node server/server.js
```

## Notes

- `players.html` stores player data only in the current browser via `localStorage`
- admin auth is stored only for the current browser session
- `roulette.html` can use `level-ids.txt` first, then fall back to the GD Browser API lookup
- the backend automatically creates `server/runs.json` if it is missing
- the backend does not automatically create `server/data.txt`, so create that file before first run

## Linux Service

For running the server on boot with `systemd`, see:

- `server/LINUX_SERVICE_SETUP.txt`

## License

See `LICENSE`.
