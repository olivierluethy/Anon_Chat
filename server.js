const express = require("express");
const http = require("http");
const path = require("path");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// ---------------------------------------------------------------------------
// In-memory room store.
//
// Rooms are keyed by a short random code, NOT by username. This is the core
// fix: a room is a first-class thing that many sockets can join, rather than
// "the username string" (which meant nobody could deliberately meet).
//
// NOTE: everything here lives in RAM and is lost on restart. This is a
// deliberate, documented limitation (see README "Known limitations").
// ---------------------------------------------------------------------------
const rooms = new Map(); // roomId -> { messages: [], members: Map<socketId, name> }

const MAX_MESSAGES_PER_ROOM = 500;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NAME_LENGTH = 40;
const ROOM_CODE_LENGTH = 5;

// Base36 code without ambiguous characters (no 0/O/1/l/i).
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function generateRoomCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code)); // guarantee uniqueness
  return code;
}

function createRoom() {
  const roomId = generateRoomCode();
  rooms.set(roomId, { messages: [], members: new Map(), typing: new Set() });
  return roomId;
}

// Tell everyone in the room who is currently typing. Each client filters
// itself out of the list, so we can broadcast the same payload to all.
function broadcastTyping(roomId, room) {
  const users = [...room.typing]
    .filter((id) => room.members.has(id))
    .map((id) => ({ id, name: room.members.get(id) }));
  io.to(roomId).emit("typing", { users });
}

function sanitizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LENGTH) || "Anonymous";
}

function sanitizeText(text) {
  return String(text || "").trim().slice(0, MAX_MESSAGE_LENGTH);
}

let messageSeq = 0;
function nextId() {
  return `m${++messageSeq}`;
}

function pushMessage(room, message) {
  room.messages.push(message);
  if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
    room.messages.shift(); // keep memory bounded
  }
}

function systemMessage(text) {
  return { id: nextId(), system: true, text, ts: Date.now() };
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Create a new room and hand back its code.
app.post("/api/rooms", (req, res) => {
  const roomId = createRoom();
  res.json({ roomId });
});

// Report whether a room exists (used by the "Join a room" flow before redirect).
app.get("/api/rooms/:roomId", (req, res) => {
  const exists = rooms.has(req.params.roomId);
  res.status(exists ? 200 : 404).json({ exists });
});

// Serve the chat interface for a specific room.
app.get("/chat/:roomId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// ---------------------------------------------------------------------------
// WebSocket layer
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  let joinedRoomId = null;

  socket.on("join-room", ({ roomId, name } = {}) => {
    const room = rooms.get(roomId);
    if (!room) {
      // The room code doesn't exist — tell the client instead of silently
      // dropping them into an empty void.
      socket.emit("join-error", { message: "That room doesn't exist. Check the code and try again." });
      return;
    }

    const displayName = sanitizeName(name);
    joinedRoomId = roomId;

    // The actual fix for "messages never arrive": put the socket in the room.
    socket.join(roomId);
    room.members.set(socket.id, displayName);

    // Send this client the backlog so they land in context.
    socket.emit("chat-history", { messages: room.messages, you: socket.id });

    // Announce presence to everyone (including the joiner, so counts match).
    const joined = systemMessage(`${displayName} joined`);
    pushMessage(room, joined);
    io.to(roomId).emit("message", joined);
    io.to(roomId).emit("presence", { count: room.members.size });
  });

  socket.on("message", ({ text } = {}) => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;

    const clean = sanitizeText(text);
    if (!clean) return; // ignore empty / whitespace-only

    // Sending a message means you've stopped typing.
    if (room.typing.delete(socket.id)) {
      broadcastTyping(joinedRoomId, room);
    }

    const message = {
      id: nextId(),
      senderId: socket.id,
      name: room.members.get(socket.id) || "Anonymous",
      text: clean,
      ts: Date.now(),
    };
    pushMessage(room, message);

    // Broadcast to the WHOLE room, sender included, so both sides render the
    // exact same message object (this is what "Nachricht bei beiden sehen"
    // was reaching for). The client tags its own messages via senderId.
    io.to(joinedRoomId).emit("message", message);
  });

  socket.on("typing", ({ isTyping } = {}) => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room || !room.members.has(socket.id)) return;

    const changed = isTyping
      ? !room.typing.has(socket.id) && (room.typing.add(socket.id), true)
      : room.typing.delete(socket.id);

    if (changed) broadcastTyping(joinedRoomId, room);
  });

  socket.on("disconnect", () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;

    const displayName = room.members.get(socket.id);
    room.members.delete(socket.id);

    // Someone who leaves is no longer typing — tell the room.
    if (room.typing.delete(socket.id)) {
      broadcastTyping(joinedRoomId, room);
    }

    if (displayName) {
      const left = systemMessage(`${displayName} left`);
      pushMessage(room, left);
      io.to(joinedRoomId).emit("message", left);
    }
    io.to(joinedRoomId).emit("presence", { count: room.members.size });

    // Reclaim memory once a room is empty.
    if (room.members.size === 0) {
      rooms.delete(joinedRoomId);
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Anon Chat running on http://localhost:${port}`);
});
