const express = require("express");
const app = express();
const socketIO = require("socket.io");
const http = require("http");
const path = require("path");
const bodyParser = require("body-parser");

// Store chat messages in memory (Replace with a database in production)
const chatMessages = {};

// Create the HTTP server
const server = http.createServer(app);

// Create the WebSocket server
const io = socketIO(server);

// Map to store socket IDs and corresponding usernames
const socketToUsername = new Map();

// Function to generate a unique chat link
function generateChatLink() {
  const chatLinkId = Math.floor(Math.random() * 1000000);
  const chatLink = `/chat/${chatLinkId}`;

  // Store chat link in memory (Replace with database storage in production)
  chatMessages[chatLink] = [];

  return chatLink;
}

// WebSocket connection event
io.on("connection", (socket) => {
  console.log("New WebSocket connection");

  // Event handling for 'join-room' event
  socket.on("join-room", (username) => {
    console.log(`Joining room: ${username}`);

    // Store the socket ID and corresponding username
    socketToUsername.set(socket.id, username);

    // Retrieve the chat history for the username
    const chatHistory = chatMessages[username] || [];
    socket.emit("chat-history", chatHistory);
  });

  // Event handling for incoming messages
  socket.on("message", (data) => {
    console.log("New message:", data);

    // Get the username associated with the socket
    const username = socketToUsername.get(socket.id);

    if (username) {
      // Store the message in the corresponding username's chatMessages (Replace with database storage in production)
      chatMessages[username].push({
        senderId: socket.id,
        message: data.message,
      });

      // Broadcast the message to all sockets in the chat room except the sender
      socket
        .to(username)
        .emit("message", { senderId: socket.id, message: data.message });
    }
  });

  // Event handling for 'generate-chat-link' event
  socket.on("generate-chat-link", () => {
    const chatLink = generateChatLink();
    // Emit 'chat-link-generated' event to the client
    socket.emit("chat-link-generated", { chat_link: chatLink });
  });

  // Event handling for disconnected connections
  socket.on("disconnect", () => {
    console.log("WebSocket connection disconnected");

    // Remove the socket ID and corresponding username from the map
    socketToUsername.delete(socket.id);
  });
});

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Render chat HTML page for a username
app.get("/chat", (req, res) => {
  const username = req.query.username;
  if (username) {
    res.sendFile(path.join(__dirname, "public", "chat.html"));
  } else {
    res.redirect("/");
  }
});

// Send a message to a username
app.post("/send-message", bodyParser.json(), (req, res) => {
  const username = req.body.username;
  const message = req.body.message;

  // Check if the username exists in the chatMessages object
  if (chatMessages.hasOwnProperty(username)) {
    // Store message in the corresponding username's chatMessages (Replace with database storage in production)
    chatMessages[username].push(message);

    // Broadcast the message to all connected sockets (tabs) in the specific chat room
    io.to(username).emit("message", { message });

    res.sendStatus(200);
  } else {
    res.sendStatus(404); // Username not found
  }
});

// Start the server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});