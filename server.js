require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const DATA_DIR = path.join(__dirname, "data");
const LEADERBOARD_FILE = path.join(DATA_DIR, "manualLeaderboard.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

let leaderboard = [];
let history = [];

fs.ensureDirSync(DATA_DIR);

if (fs.existsSync(LEADERBOARD_FILE)) {
  leaderboard = fs.readJsonSync(LEADERBOARD_FILE);
}

if (fs.existsSync(HISTORY_FILE)) {
  history = fs.readJsonSync(HISTORY_FILE);
}

function saveLeaderboard() {
  fs.writeJsonSync(LEADERBOARD_FILE, leaderboard, { spaces: 2 });
}

function saveHistory() {
  fs.writeJsonSync(HISTORY_FILE, history, { spaces: 2 });
}

function sortLeaderboard() {
  leaderboard.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
}

function requireAdminKey(req, res) {
  const key = req.body?.key || req.query?.key;

  if (key !== process.env.ADMIN_CLEAR_KEY) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }

  return true;
}

/* PUBLIC API */

app.get("/api/wagers", (req, res) => {
  sortLeaderboard();
  res.json(leaderboard);
});

app.get("/api/history", (req, res) => {
  res.json(history);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    entries: leaderboard.length,
    historyWeeks: history.length
  });
});

/* ADMIN API */

app.post("/admin/add-player", (req, res) => {
  if (!requireAdminKey(req, res)) return;

  const { wallet, username, amount } = req.body;

  if (!wallet || amount === undefined || Number.isNaN(Number(amount))) {
    return res.status(400).json({ error: "wallet and valid amount are required" });
  }

  const existing = leaderboard.find((p) => p.user === wallet);

  if (existing) {
    existing.username = username || existing.username || null;
    existing.amount = Number(existing.amount || 0) + Number(amount || 0);
  } else {
    leaderboard.push({
      user: wallet,
      username: username || null,
      amount: Number(amount || 0),
      createdAt: new Date().toISOString()
    });
  }

  sortLeaderboard();
  saveLeaderboard();
  io.emit("update");

  res.json({ success: true });
});

app.post("/admin/set-player", (req, res) => {
  if (!requireAdminKey(req, res)) return;

  const { wallet, username, amount } = req.body;

  if (!wallet) {
    return res.status(400).json({ error: "wallet is required" });
  }

  const existing = leaderboard.find((p) => p.user === wallet);

  if (!existing) {
    return res.status(404).json({ error: "Player not found" });
  }

  if (username !== undefined) {
    existing.username = username;
  }

  if (amount !== undefined) {
    if (Number.isNaN(Number(amount))) {
      return res.status(400).json({ error: "amount must be a valid number" });
    }
    existing.amount = Number(amount || 0);
  }

  sortLeaderboard();
  saveLeaderboard();
  io.emit("update");

  res.json({ success: true });
});

app.post("/admin/delete-player", (req, res) => {
  if (!requireAdminKey(req, res)) return;

  const { wallet } = req.body;

  if (!wallet) {
    return res.status(400).json({ error: "wallet is required" });
  }

  leaderboard = leaderboard.filter((p) => p.user !== wallet);

  saveLeaderboard();
  io.emit("update");

  res.json({ success: true });
});

app.post("/admin/reset-week", (req, res) => {
  if (!requireAdminKey(req, res)) return;

  sortLeaderboard();

  const winners = leaderboard.slice(0, 3);

  history.push({
    date: new Date().toISOString(),
    winners
  });

  saveHistory();

  leaderboard = [];
  saveLeaderboard();
  io.emit("update");

  res.json({ success: true, message: "Week reset complete" });
});

app.post("/admin/clear-all", (req, res) => {
  if (!requireAdminKey(req, res)) return;

  leaderboard = [];
  saveLeaderboard();
  io.emit("update");

  res.json({ success: true });
});

/* START SERVER */

io.on("connection", () => {
  console.log("User connected");
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});