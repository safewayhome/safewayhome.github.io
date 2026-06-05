# SafeWayHome · Team Board 🕸️🗓️📊

A realtime, desktop team board tailored for the 3-person SafeWayHome dev team — like a tiny
Microsoft Whiteboard / FigJam / Trello, but built around *our* four teams and *our* roadmap.

Three views, one shared dataset:

- **Whiteboard** — a *spider-web* of everything to build. Each team is a hub; tasks ring around
  it; dependency threads cross the web. **Done** tasks fade to translucent + green ✓ so you can
  see at a glance how far we've come. Drag tasks around (positions sync to everyone).
- **Timeline** — the order we want to do things in. Each card says *what* to do and, if we have
  an idea, *how* we'll solve it. Reorder with ↑/↓.
- **Progress** — an estimate-weighted progress bar (weighted by how long each task is estimated
  to take, not just task count) plus a written breakdown: hours spent vs. remaining, per team,
  and a rough calendar estimate for 3 people.

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

This is deployed as the **org root site** at **https://safewayhome.github.io/** from the repo
`safewayhome/safewayhome.github.io`. Pushing to `main` triggers `.github/workflows/deploy.yml`, which
builds with Vite (base `/` for a `*.github.io` repo, `/<repo>/` otherwise) and publishes `dist/` to
Pages. Enable once: **Repo → Settings → Pages → Source: GitHub Actions**.

## Tech

React 18 + Vite · React Flow (whiteboard graph) · Yjs + Trystero (Nostr) + y-indexeddb (realtime) ·
inline styles in the SafeWayHome palette (gräddvit + rose, Nunito). No tracking, no accounts.
