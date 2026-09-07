# Broadside — a Pirates!-inspired prototype

This is the first playable slice of a game inspired by *Sid Meier's Pirates!*.
It runs entirely in a web browser — nothing to install. Right now it covers
just the core of what makes Pirates! fun: **sailing an open sea and fighting
other ships with cannons.** Everything else the original game is known for
(visiting towns, trading, sword duels, a career that spans decades) is on the
roadmap below, added in stages once this core feels good.

## How to play it

**Easiest way:** open `index.html` in this repository directly — most code
hosts (including GitHub) can render it for you, or once GitHub Pages is
turned on for this repo (see below) you'll get a permanent link you can open
on any device.

**Controls**
- Arrow keys or `WASD` — trim your sails and steer
- `Q` — fire your left (port) cannons
- `E` — fire your right (starboard) cannons

Wind matters: sailing with the wind behind you is faster than sailing into
it, so watch the compass in the top-right corner.

## Turning on the free hosted link (one-time, 2 minutes)

GitHub can host this game for free at a permanent web address, but it needs
to be switched on once by whoever owns the repository:

1. Go to the repository on github.com, click **Settings**.
2. In the left sidebar, click **Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch".
4. Choose the branch this was pushed to and `/ (root)` as the folder, then
   **Save**.
5. GitHub will show a link like `https://<your-username>.github.io/Pirates-for-Claude/`
   within a minute or two — that's the game, live and shareable.

## What's here so far

- An animated 3D ocean (shader-driven waves, no static water texture)
- A player ship you sail with wind-affected speed
- AI enemy ships that patrol, spot you, close in, and fire back
- Broadside cannon combat with arcing cannonballs, hit damage, and sinking
- A "ship's log" style HUD: hull integrity, speed, wind/heading compass,
  reload timers, and a running combat log
- Title and "you've been sunk" screens with a restart loop

Everything is built from code — there are no downloaded 3D models or images,
so nothing here can break due to a missing file.

## Roadmap (what would come next)

Roughly in the order they'd add the most back toward the original game:

1. **Ports & towns** — sail into a harbor, dock, and open a town screen
2. **Trading economy** — buy low, sell high, cargo holds with limited space
3. **Crew & fleet** — recruit crew, capture enemy ships instead of only sinking them
4. **Nations & reputation** — different flags react differently to your actions
5. **Missions & treasure** — governor errands, treasure maps, rescuing captives
6. **Sword-fighting duels** — a boarding minigame when you win a ship battle
7. **A "career"** — an aging captain, retirement, a scored ending

## For the non-programmer following along

You don't need to read or understand the code to steer this project. Useful
things to know:
- `index.html` is the page structure and on-screen panels
- `style.css` is everything about how it looks (colors, fonts, layout)
- `js/game.js` is everything about how it behaves (physics, AI, combat)

If you want something changed — a color, a control scheme, an enemy that's
too aggressive, a new feature from the roadmap — just describe what you want
in plain language and it gets implemented here.
