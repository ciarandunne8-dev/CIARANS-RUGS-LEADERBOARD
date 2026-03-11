// server.js
require('dotenv').config(); // load .env
const express = require('express');
const fetch = require('node-fetch'); // make sure you installed node-fetch@2
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

app.use(express.json());
app.use(express.static('public')); // your index.html and JS live here

let wagers = [];

// Endpoint to get all wagers
app.get("/api/wagers", async (req, res) => {
  res.json(wagers);
});

// Example: fetch mints from Helius (optional if you want to auto-populate)
app.get("/api/fetchHelius", async (req, res) => {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/mints?api-key=${HELIUS_API_KEY}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching from Helius");
  }
});

// Webhook endpoint for real-time wagers
app.post("/webhook", (req, res) => {
  const events = req.body;

  events.forEach(ev => {
    const wallet = ev.feePayer;
    const amount = ev.nativeTransfers?.[0]?.amount / 1e9;
    const referral = ev.memo;

    if (wallet && amount && referral === "rugsmademebroke") {
      wagers.push({
        user: wallet, // you can replace this with username if Helius provides it
        amount: amount
      });
    }
  });

  // Tell all browsers to reload leaderboard
  io.emit("update");

  res.sendStatus(200);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
