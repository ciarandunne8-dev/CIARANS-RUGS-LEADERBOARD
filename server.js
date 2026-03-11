require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const fs = require("fs-extra");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const DATA_DIR = path.join(__dirname, "data");
const WAGERS_FILE = path.join(DATA_DIR, "wagers.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

let wagers = [];
let history = [];
let processedTx = new Set();

fs.ensureDirSync(DATA_DIR);

if (fs.existsSync(WAGERS_FILE)) {
  wagers = fs.readJsonSync(WAGERS_FILE);
}

if (fs.existsSync(HISTORY_FILE)) {
  history = fs.readJsonSync(HISTORY_FILE);
}

function saveWagers() {
  fs.writeJsonSync(WAGERS_FILE, wagers, { spaces: 2 });
}

function saveHistory() {
  fs.writeJsonSync(HISTORY_FILE, history, { spaces: 2 });
}

function getLeaderboardTotals() {
  const totals = {};

  wagers.forEach((w) => {
    if (!totals[w.user]) {
      totals[w.user] = {
        user: w.user,
        username: w.username || null,
        amount: 0
      };
    }

    totals[w.user].amount += Number(w.amount || 0);

    if (w.username) {
      totals[w.user].username = w.username;
    }
  });

  return Object.values(totals).sort((a, b) => b.amount - a.amount);
}

app.get("/api/wagers", (req, res) => {
  res.json(wagers);
});

app.get("/api/history", (req, res) => {
  res.json(history);
});

/* ADMIN CLEAR LEADERBOARD */
app.get("/clear", (req, res) => {

  const key = req.query.key;

  if (key !== process.env.ADMIN_CLEAR_KEY) {
    return res.status(403).send("Forbidden");
  }

  wagers = [];
  saveWagers();

  io.emit("update");

  res.send("Leaderboard cleared");

});

/* WEBHOOK FOR HELIUS */

app.post("/webhook", (req, res) => {

  const events = Array.isArray(req.body) ? req.body : [req.body];

  events.forEach(ev => {

    const tx = ev.signature || ev.transactionSignature;

    if (tx && processedTx.has(tx)) return;

    if (tx) processedTx.add(tx);

    const wallet =
      ev.feePayer ||
      ev.account ||
      ev.wallet ||
      null;

    let amount = 0;

    if (ev.nativeTransfers && ev.nativeTransfers.length > 0) {
      amount = ev.nativeTransfers[0].amount / 1e9;
    }

    const eventText = JSON.stringify(ev).toLowerCase();

    const referralFound = eventText.includes("rugsmademebroke");

    if (wallet && amount > 0 && referralFound) {

      wagers.push({
        user: wallet,
        username: ev.username || null,
        amount: amount,
        createdAt: new Date().toISOString()
      });

      console.log("New wager detected:", wallet, amount);
    }

  });

  saveWagers();

  io.emit("update");

  res.sendStatus(200);

});

/* WEEKLY RESET — SUNDAY 12:05 AM */

cron.schedule("5 0 * * 0", () => {

  console.log("Running weekly leaderboard reset");

  const winners = getLeaderboardTotals().slice(0, 3);

  history.push({
    date: new Date().toISOString(),
    winners: winners
  });

  saveHistory();

  wagers = [];
  saveWagers();

  io.emit("update");

});

io.on("connection", () => {
  console.log("User connected");
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});