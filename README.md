# LedMig · Team Board 🧩🗓️📊📜

A realtime, desktop team board tailored for the 3-person LedMig dev team — like a tiny
Microsoft Whiteboard / FigJam / Trello, but built around *our* four teams and *our* roadmap.

Each task carries a **difficulty** — one of four fixed, colour-coded grades: 🟢 Enkla (easy),
🟡 Medel (medium), 🔴 Svåra (hard), 🟥 Extremt svåra (extreme). (We track difficulty, not hours.)

Four views, one shared dataset:

- **Nätet** — clean category *lanes* (one column per team) instead of a tangled web. Cards are
  colour-coded by difficulty; only real **dependencies** are drawn, as soft rounded arrows. Add a
  card with the **＋** in any lane header or by double-clicking the canvas; drag cards anywhere
  (positions sync to everyone), and **⊞ Ordna kolumner** snaps them back into tidy columns.
- **Tidslinje** — the order we want to do things in. Each card says *what* to do and, if we have
  an idea, *how* we'll solve it. Reorder with ↑/↓.
- **Framsteg** — a main progress bar (**done tasks / total**) plus one bar per difficulty grade
  showing how much of that grade is finished, and a per-team breakdown. All count-based.
- **Changelog** — a human, jargon-free description of what LedMig is, a layered diagram of how the
  system fits together (app → API → core → storage → data sources), and a chronological log of
  everything built and everything still planned, with calm scroll-reveal.

Filter which teams/sub-categories are visible with the checkboxes up top (your view is yours —
filters are local, the data is shared).

## Realtime, with no backend

Collaboration runs **peer-to-peer**: [Yjs](https://yjs.dev) (CRDT) synced over
[Trystero](https://github.com/dmotz/trystero) on public **Nostr** relays, with `y-indexeddb` for
offline persistence. You see teammates' **mouse cursors**, their **avatars**, and a **✍️ "is
typing"** marker live. The relays only broker the WebRTC handshake — the actual board data flows
directly between your browsers and is **encrypted** with the room password. No accounts, no server,
nothing stored centrally.

(We use Nostr relays because the old public `y-webrtc` signaling servers are dead; Nostr relays are
plentiful and maintained, and Trystero uses several at once for redundancy.)

The same build runs locally and on GitHub Pages, so whoever is on either one syncs together.

## Run locally

```bash
cd team-board
npm install
npm run dev          # http://localhost:5180
```

Open it in two browser windows (or share your screen) to see realtime sync. First load asks for
your name + colour.

## Invite the team

Use the ⚙️ settings dialog → **copy invite link**. It pins the same room + password via URL
(`?room=…&pass=…`). Everyone on that link shares the board.

## If a relay is flaky

The board connects to several Nostr relays at once, so one being down doesn't matter. If you ever
need to override them (or run a fully private rendezvous), pass your own:

```
<board-url>?relays=wss://relay.damus.io,wss://nos.lol
```

## Deploy (GitHub Pages)

This is deployed as the **org root site**. Public domain: **https://ledmig.nu/** (set as a CNAME on
the GitHub Pages site **safewayhome.github.io**) from the repo `safewayhome/safewayhome.github.io`
(GitHub org/repo names unchanged — only the public domain rebrands). Pushing to `main` triggers
`.github/workflows/deploy.yml`, which
builds with Vite (base `/` for a `*.github.io` repo, `/<repo>/` otherwise) and publishes `dist/` to
Pages. Enable once: **Repo → Settings → Pages → Source: GitHub Actions**.

## Tech

React 18 + Vite · React Flow (whiteboard graph) · Yjs + Trystero (Nostr) + y-indexeddb (realtime) ·
inline styles in the LedMig palette (gräddvit + rose, Nunito). No tracking, no accounts.
