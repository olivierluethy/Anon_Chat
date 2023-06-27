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

// Map to store socket IDs and corresponding chat links
const socketToChatLink = new Map();

// Function to generate a unique chat link
function generateChatLink() {
  const chatLinkId = Math.floor(Math.random() * 1000000);
  const chatLink = `/chat/${chatLinkId}`;

  // Store chat link in memory (Replace with database storage in production)
  chatMessages[chatLink] = [];

  return chatLink;
}

// WebSocket connection event
io.on("connection", socket => {
  console.log("New WebSocket connection");

  // Event handling for 'join-room' event
  socket.on("join-room", chatLink => {
    console.log(`Joining room: ${chatLink}`);

    // Store the socket ID and corresponding chat link
    socketToChatLink.set(socket.id, chatLink);

    // Join the chat room
    socket.join(chatLink);

    // Retrieve the chat history for the chat link
    const chatHistory = chatMessages[chatLink] || [];
    socket.emit("chat-history", chatHistory);
  });

  // Event handling for incoming messages
  socket.on("message", data => {
    console.log("New message:", data);

    // Get the chat link associated with the socket
    const chatLink = socketToChatLink.get(socket.id);

    if (chatLink) {
      // Store the message in the corresponding chat link's chatMessages (Replace with database storage in production)
      chatMessages[chatLink].push(data.message);

      // Broadcast the message to all sockets in the chat room
      io.to(chatLink).emit("message", data);
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

    // Remove the socket ID and corresponding chat link from the map
    socketToChatLink.delete(socket.id);
  });
});

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Generate a unique chat link
app.get("/generate-chat-link", (req, res) => {
  const chatLinkId = Math.floor(Math.random() * 1000000);
  const chatLink = `/chat/${chatLinkId}`;

  // Store chat link in memory (Replace with database storage in production)
  chatMessages[chatLink] = [];

  res.json({ chat_link: chatLink });
});

// Render chat HTML page for a chat link
app.get("/chat/:chatLinkId", (req, res) => {
  const chatLinkId = req.params.chatLinkId;
  const chatLink = `/chat/${chatLinkId}`;

  // Render the chat HTML page
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Send a message to a chat link
app.post("/send-message", bodyParser.json(), (req, res) => {
  const chatLink = req.body.chat_link;
  const message = req.body.message;

  // Check if the chat link exists in the chatMessages object
  if (chatMessages.hasOwnProperty(chatLink)) {
    // Store message in the corresponding chat link's chatMessages (Replace with database storage in production)
    chatMessages[chatLink].push(message);

    // Broadcast the message to all connected sockets (tabs) in the specific chat room
    io.to(chatLink).emit("message", { message });
    
    res.sendStatus(200);
  } else {
    res.sendStatus(404); // Chat link not found
  }
});


// Start the server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});