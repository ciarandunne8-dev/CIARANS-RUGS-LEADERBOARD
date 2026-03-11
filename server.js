// server.js

require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000; // IMPORTANT for Render
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

app.use(express.json());
app.use(express.static("public"));

let wagers = [];

/*
Return wagers to the leaderboard
*/
app.get("/api/wagers", (req, res) => {
  res.json(wagers);
});

/*
Optional Helius test endpoint
*/
app.get("/api/fetchHelius", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.helius.xyz/v0/mints?api-key=${HELIUS_API_KEY}`
    );

    const data = await response.json();

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching from Helius");
  }
});

/*
Webhook endpoint
Helius will send transactions here
*/
app.post("/webhook", (req, res) => {

  const events = req.body;

  events.forEach(ev => {

    const wallet = ev.feePayer;
    const amount = ev.nativeTransfers?.[0]?.amount / 1e9;
    const referral = ev.memo;

    if (wallet && amount && referral === "rugsmademebroke") {

      wagers.push({
        user: wallet,
        amount: amount
      });

      console.log("New wager:", wallet, amount);

    }

  });

  // tell all browsers to update leaderboard
  io.emit("update");

  res.sendStatus(200);
});

/*
Socket connection
*/
io.on("connection", (socket) => {
  console.log("User connected");
});

/*
Start server
*/
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
