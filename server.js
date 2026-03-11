require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const fs = require("fs-extra");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const DATA_FILE = "wagers.json";
const HISTORY_FILE = "history.json";

let wagers = [];
let history = [];

/*
Load saved data when server starts
*/
if (fs.existsSync(DATA_FILE)) {
  wagers = fs.readJsonSync(DATA_FILE);
}

if (fs.existsSync(HISTORY_FILE)) {
  history = fs.readJsonSync(HISTORY_FILE);
}

/*
Save wagers to disk
*/
function saveWagers() {
  fs.writeJsonSync(DATA_FILE, wagers);
}

/*
Save history
*/
function saveHistory() {
  fs.writeJsonSync(HISTORY_FILE, history);
}

/*
Return leaderboard
*/
app.get("/api/wagers", (req, res) => {
  res.json(wagers);
});

/*
Return past winners
*/
app.get("/api/history", (req, res) => {
  res.json(history);
});

/*
Webhook endpoint
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

      saveWagers();

      console.log("New wager:", wallet, amount);

    }

  });

  io.emit("update");

  res.sendStatus(200);
});

/*
Weekly reset
Saturday 00:05
*/
cron.schedule("5 0 * * 6", () => {

  console.log("Weekly reset");

  const totals = {};

  wagers.forEach(w => {
    if (!totals[w.user]) totals[w.user] = 0;
    totals[w.user] += w.amount;
  });

  const sorted = Object.entries(totals)
    .map(([user, amount]) => ({ user, amount }))
    .sort((a, b) => b.amount - a.amount);

  const winners = sorted.slice(0, 3);

  history.push({
    date: new Date(),
    winners
  });

  saveHistory();

  wagers = [];
  saveWagers();

  io.emit("update");

});

/*
Socket connection
*/
io.on("connection", () => {
  console.log("User connected");
});

/*
Start server
*/
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
