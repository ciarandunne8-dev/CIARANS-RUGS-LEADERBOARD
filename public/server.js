const express = require("express");
const fetch = require("node-fetch");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const PORT = 3000;

let wagers = [];

// Send wagers to website
app.get("/api/wagers", (req,res)=>{
  res.json(wagers);
});

// Webhook endpoint
app.post("/webhook", (req, res) => {
  const events = req.body;

  events.forEach(ev => {
    // Extract wallet and amount
    const wallet = ev.feePayer;
    const amount = ev.nativeTransfers?.[0]?.amount / 1e9;

    // Check if referral code exists
    // Rugs.fun usually puts the referral in the 'memo' field
    const referral = ev.memo;

    if(wallet && amount && referral === "rugsmademebroke") {
      wagers.push({
        user: wallet,
        amount: amount
      });
    }
  });

  // Tell all browsers to reload leaderboard
  io.emit("update");

  res.sendStatus(200);
});

server.listen(PORT,()=>{
  console.log(`Leaderboard running at http://localhost:${PORT}`);
});