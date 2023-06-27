const express = require("express");
const app = express();
// CORS configuration
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000/");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
const bodyParser = require("body-parser");
const path = require("path");

// Store chat messages in memory (Replace with a database in production)
const chatMessages = {};

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

  // Store message in the corresponding chat link's chatMessages (Replace with database storage in production)
  chatMessages[chatLink].push(message);

  res.sendStatus(200);
});

// Retrieve chat history for a chat link
app.post("/chat-history", bodyParser.json(), (req, res) => {
  const chatLink = req.body.chat_link;
  const chatHistory = chatMessages[chatLink] || [];

  res.json(chatHistory);
});

// Start the server
app.listen(3000, () => {
  console.log("Server started on port 3000");
});
