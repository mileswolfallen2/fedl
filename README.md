# GD FEDL

A Geometry Dash FEDL-style website with both a static list and a live editable server list.

It includes:

- a home page
- a static list page
- a live server-backed list page
- an admin editor page for the live list
- a players page
- a rules page

## Project Files

- `index.html` - home page
- `lists.html` - static list view
- `serverlist.html` - live server-backed list view
- `admelist.html` - admin UI for editing the live list
- `players.html` - player manager
- `rules.html` - submission rules and mod guidelines
- `app.js` - client-side logic
- `styles.css` - site styling
- `data.txt` - static fallback list data
- `server/data.txt` - live server list data
- `server/server.js` - Node.js server for the live list
- `start-server.command` - one-click launcher for macOS
- `server/LINUX_SERVICE_SETUP.txt` - Linux `systemd` setup notes

## Data Format

Both `data.txt` and `server/data.txt` use the same format:

```txt
category|position|title|url
```

Example:

```txt
new|1|Flamewall|https://youtu.be/x4Io4zkWVRw
```

## Pages

- `lists.html` reads the static list.
- `serverlist.html` reads the live server list.
- `admelist.html` lets you edit the live server list with a UI.

## Fallback Order

The live list tries these in order:

1. `/api/list`
2. `server/data.txt`
3. `data.txt`

That means `serverlist.html` can still show data even if the live API is down.

## Running The Static Site

If you only want the static pages, you can run a simple file server:

```bash
python3 -m http.server 8000
```

Then open:

```txt
http://localhost:8000
```

## Running The Live Server

The live editor and live list use the Node server:

```bash
node server/server.js
```

Or to allow other devices on your network to connect:

```bash
HOST=0.0.0.0 PORT=3000 node server/server.js
```

Then open:

```txt
http://localhost:3000/serverlist.html
http://localhost:3000/admelist.html
```

On macOS you can also use:

```txt
start-server.command
```

## Editing The Live List

Open `admelist.html` through the Node server.

Features:

- add a new row at the top as a draft
- give it a number when you want to place it
- automatic shifting of other rows when a number is reused
- delete rows only with the Delete button
- live refresh on connected list pages after saving

Draft rows must be assigned a number before saving.

## Hosting On Another Device

If you want one device to host the live list for other devices:

1. Run the server with `HOST=0.0.0.0`.
2. Open or forward port `3000`.
3. Visit `http://YOUR-IP:3000/serverlist.html` or `http://YOUR-IP:3000/admelist.html`.

If you already have router port forwarding set up, point it to the machine running `server/server.js`.

## Linux Service

For running the Node server automatically on boot on Linux, see:

`server/LINUX_SERVICE_SETUP.txt`

## Notes

- Player data is stored in the browser with `localStorage`
- The players list is local to each browser/device
- The live list data is stored in `server/data.txt`
- The static fallback list data is stored in `data.txt`
- The project does not need a build step
