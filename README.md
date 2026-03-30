# GD FEDL

A simple static website for a Geometry Dash FEDL-style list.

It includes:

- a home page
- a list page for ranked level videos
- a players page
- a rules page

## Project Files

- `index.html` - home page
- `lists.html` - main list view
- `players.html` - player manager
- `rules.html` - submission rules and mod guidelines
- `app.js` - client-side logic for the list and players pages
- `styles.css` - site styling
- `data.txt` - list data used by the videos page

## How The List Data Works

The site reads `data.txt` and shows the entries on `lists.html`.

Each line in `data.txt` uses this format:

```txt
category|position|title|url
```

Example:

```txt
new|1|Flamewall|https://youtu.be/x4Io4zkWVRw
```

## Running The Site

Because the list page uses `fetch()` to load `data.txt`, you should run the project with a local server instead of opening the HTML files directly.

Example with Python:

```bash
python3 -m http.server 8000
```

Then open:

```txt
http://localhost:8000
```

## Editing The List

To add a new level, add a new line to `data.txt` using the same format:

```txt
new|51|Level Name|https://youtube.com/watch?v=example
```

Tips:

- keep positions numeric so sorting works correctly
- use a valid YouTube link if you want the in-page video modal to work
- avoid blank lines with partial data

## Notes

- Player data is stored in the browser with `localStorage`
- The players list is local to each browser/device
- The current layout is lightweight and does not need a build step
