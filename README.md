# Anon Chat

Ephemeral, anonymous, real-time chat rooms. No accounts, no database, no
history that outlives the conversation. You create a room, share its short
code, and talk. When everyone leaves, the room and everything in it are gone.

Built with **Node.js**, **Express**, and **Socket.IO** — vanilla HTML/CSS/JS on
the front end, no build step.

---

## What it's for

A minimal, self-hostable space for a throwaway conversation:

- **Anonymous** — pick any display name, no sign-up.
- **Private by obscurity** — rooms are reachable only via their random code.
- **Ephemeral** — messages live in memory and vanish when the room empties.
- **Instant** — messages arrive over WebSockets in real time.

It's also a teaching codebase: the section below is a post-mortem of how the
original version was broken and how it was fixed, so future contributors don't
repeat the same mistakes.

---

## Running it

Requires Node.js 16+.

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
# (equivalent to: node server.js)

# 3. Open the app
#    http://localhost:3000
```

Set a custom port with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

### Try it end-to-end

1. Open `http://localhost:3000`, enter a display name, click **Create a room**.
2. You'll land in the room. Click **Copy link**.
3. Open that link in a second browser (or an incognito window), enter a
   different name, and start typing. Both windows see every message in real
   time.

---

## How it works

```
Browser (index.html)                     Server (server.js)
  │  POST /api/rooms  ───────────────────▶  createRoom() -> "8f3a2"
  │  ◀─────────────── { roomId: "8f3a2" }
  │
  │  navigate to /chat/8f3a2?name=Alice
  ▼
Browser (chat.html)
  │  socket "join-room" { roomId, name } ─▶  socket.join(roomId)
  │  ◀── "chat-history" { messages, you }     members.set(id, name)
  │  ◀── "presence" { count }
  │
  │  socket "message" { text } ───────────▶  io.to(roomId).emit("message", …)
  │  ◀── "message" (broadcast to whole room, sender included)
```

- **Rooms** are keyed by a short random code, stored in an in-memory `Map`.
- **A socket joins a real Socket.IO room** (`socket.join(roomId)`) — this is the
  single most important line, and the one the original code was missing.
- **Messages are broadcast to the entire room including the sender**, so every
  participant renders the exact same message object. The client decides which
  bubbles are "yours" by comparing `senderId` to its own socket id.

---

## Issues in the original version, and how they were fixed

The original app looked complete but was fundamentally broken. Here is each
problem, **why** it failed, and the fix.

### 1. Messages never reached anyone (the core bug)

**What happened:** two people in the "same room" never saw each other's
messages.

**Why:** the server tracked usernames in a `socketToUsername` map but **never
actually joined the socket to a Socket.IO room**. It then tried to broadcast
with:

```js
socket.to(username).emit("message", …);
```

`socket.to(<room>)` sends to every socket *in that room* — but no socket had
ever been added to the room via `socket.join(...)`. The room was always empty,
so the broadcast went to nobody.

**Fix:** on join, actually put the socket in the room, then broadcast to it:

```js
socket.join(roomId);
room.members.set(socket.id, displayName);
// …later…
io.to(roomId).emit("message", message);
```

### 2. "Username" was overloaded as the room identity

**Why it failed:** the room *was* the username string. Two people could only
meet if they independently typed the identical username — there was no way to
deliberately share a room, and anyone reusing a common name would collide into a
stranger's conversation.

**Fix:** rooms are now first-class, identified by a **random 5-character code**
(ambiguous characters like `0/o/1/l` removed). Display name and room identity
are fully separated. A **Create a room** button mints a code; a **Join a room**
field takes a code someone shared with you.

### 3. The sender couldn't see their own message

**Why it failed:** the broadcast used `socket.to(room)` which excludes the
sender by design. Even if rooms had worked, you'd never see your own messages.
This is what the `"Nachricht bei beiden sehen"` ("show the message on both
sides") commit was reaching for but never solved.

**Fix:** broadcast with `io.to(roomId)` (includes the sender). The client tags
its own messages by matching `senderId` against the socket id it received in
`chat-history`, and styles them distinctly.

### 4. Dead and duplicated code paths

**Why it was a problem:** the server carried a `generate-chat-link` socket event
and a `POST /send-message` REST endpoint that the front end never called, plus a
`chatMessages` store keyed inconsistently (sometimes an object, sometimes a bare
message). This is confusing and rots.

**Fix:** removed both unused paths. Room creation is a single, honest endpoint
(`POST /api/rooms`). Messages always have a consistent shape:
`{ id, senderId, name, text, ts }` (or `{ id, system: true, text, ts }`).

### 5. No feedback for a bad room code

**Why it was a problem:** joining a non-existent room silently dropped you into
an empty void with no explanation.

**Fix:** the server replies with a `join-error` event, and the front end checks
`GET /api/rooms/:id` before redirecting, so a wrong code produces a clear
message instead of a dead screen.

### 6. Unbounded memory growth

**Why it was a problem:** messages accumulated forever, and rooms were never
cleaned up.

**Fix:** each room caps its backlog (`MAX_MESSAGES_PER_ROOM`), message text is
length-limited, and a room is deleted from memory once its last member leaves.

### 7. Input handling / safety

**Why it was a problem:** no trimming, no length limits, and message rendering
needs to be XSS-safe.

**Fix:** names and message text are trimmed and length-capped on the server.
On the client, message text is HTML-escaped before being inserted; the search
highlighter builds its `<mark>` tags from **already-escaped** text, so user
input can never inject markup.

### 8. Missing project metadata

**Why it was a problem:** `package.json` had no `name`, `version`, or `start`
script, and listed `body-parser` which is redundant on modern Express.

**Fix:** added `name`, `version`, `description`, and an `npm start` script.
Replaced `body-parser` with the built-in `express.json()` and dropped the
dependency.

---

## Reflections for contributors

Two design topics worth thinking through before extending this app.

### How search is (and could be) done

**What's implemented now:** search is **client-side and live**. The chat client
keeps every message it has rendered in an `allMessages` array. Typing in the
search box sets a `filter` string and re-renders, keeping only messages whose
name or text contains the term, and wrapping matches in `<mark>`.

This is the right call at this scale: a room holds at most a few hundred
messages, all already in the browser, so filtering is instant and needs zero
server round-trips.

**How it would scale:** the moment history outgrows what a browser can hold in
memory, search has to move server-side. The progression looks like:

1. **Server-side filter** — a `search` socket/HTTP request that scans a room's
   message array and returns matches. Trivial to add, works to tens of
   thousands of messages.
2. **An index** — once messages are persisted (see below), put them behind a
   real text index (SQLite FTS5, Postgres `tsvector`, or an external engine like
   Meilisearch/Elasticsearch) so search is sublinear and supports ranking,
   phrases, and typo tolerance.
3. **Scope** — decide whether search is per-room (current mental model) or
   cross-room for a signed-in user. That decision depends entirely on the
   product's privacy stance.

### How chats relate to and are handled alongside each other

Right now every room is an **island**: an entry in a `Map`, isolated from every
other room, with no shared state and no way to move between rooms except by
leaving and joining. That isolation is a feature — it's what makes rooms private
and disposable — and it keeps the mental model tiny.

If rooms ever need to relate to one another, these are the axes to think about:

- **Discovery vs. privacy.** A room *list* or *browser* (search across rooms,
  see who's online) is directly at odds with "reachable only via a shared
  code." Any cross-room surface has to make that trade-off explicitly.
- **Identity across rooms.** Today a "user" is just a socket in one room. Being
  in multiple rooms at once, or carrying a name/history between them, requires a
  real identity layer (accounts or at least a persistent client token).
- **State ownership.** The in-memory `Map` works because one process owns all
  rooms. Running more than one server instance breaks this — two users on
  different instances wouldn't share a room. Scaling horizontally means moving
  room state to a shared backing store and using a Socket.IO adapter (e.g. the
  Redis adapter) so broadcasts reach every instance.

Keeping rooms independent is what keeps this codebase small and understandable.
Add relationships between them only when a concrete feature demands it.

---

## Known limitations (by design)

- **In-memory only.** Messages are never written to disk. Restarting the server
  wipes every room. To persist, swap the `rooms` `Map` for a datastore and
  reload on boot.
- **Single instance.** All room state lives in one process (see reflection
  above).
- **Privacy is by obscurity.** Room codes are unguessable in practice but there
  is no authentication or encryption. Don't use this for anything sensitive.

---

## Project layout

```
Anon_Chat/
├── server.js          # Express + Socket.IO server, room + message logic
├── package.json       # metadata, deps (express, socket.io), start script
└── public/
    ├── index.html     # landing page: create or join a room
    └── chat.html      # the room: messages, presence, search, composer
```
