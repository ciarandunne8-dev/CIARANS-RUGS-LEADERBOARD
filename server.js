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
const MIN_WAGER_SOL = 0.001;

/*
  Rugs.fun receiving wallet
  Helius should monitor this wallet
*/
const RUGS_WALLET = "8VVe4Lk5veqnsmGzc8UZaue7S9vywBYf4Cgw8LXW7Tg";

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const DATA_DIR = path.join(__dirname, "data");
const WAGERS_FILE = path.join(DATA_DIR, "wagers.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const PROCESSED_FILE = path.join(DATA_DIR, "processedTx.json");
const REFERRED_FILE = path.join(DATA_DIR, "referredWallets.json");

let wagers = [];
let history = [];
let processedTx = new Set();
let referredWallets = {};

fs.ensureDirSync(DATA_DIR);

if (fs.existsSync(WAGERS_FILE)) {
  wagers = fs.readJsonSync(WAGERS_FILE);
}

if (fs.existsSync(HISTORY_FILE)) {
  history = fs.readJsonSync(HISTORY_FILE);
}

if (fs.existsSync(PROCESSED_FILE)) {
  const savedProcessed = fs.readJsonSync(PROCESSED_FILE);
  processedTx = new Set(Array.isArray(savedProcessed) ? savedProcessed : []);
}

if (fs.existsSync(REFERRED_FILE)) {
  referredWallets = fs.readJsonSync(REFERRED_FILE);
}

function saveWagers() {
  fs.writeJsonSync(WAGERS_FILE, wagers, { spaces: 2 });
}

function saveHistory() {
  fs.writeJsonSync(HISTORY_FILE, history, { spaces: 2 });
}

function saveProcessedTx() {
  fs.writeJsonSync(PROCESSED_FILE, Array.from(processedTx), { spaces: 2 });
}

function saveReferredWallets() {
  fs.writeJsonSync(REFERRED_FILE, referredWallets, { spaces: 2 });
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

function extractSignature(ev) {
  return ev.signature || ev.transactionSignature || ev.txHash || null;
}

function extractWallet(ev) {
  return ev.feePayer || ev.account || ev.wallet || ev.signer || null;
}

function extractAmount(ev) {
  if (ev.nativeTransfers && Array.isArray(ev.nativeTransfers) && ev.nativeTransfers.length > 0) {
    return Number(ev.nativeTransfers[0].amount || 0) / 1e9;
  }
  return 0;
}

/*
  Register a wallet as referred
  You can call this from your website / landing page
*/
app.post("/register-referral", (req, res) => {
  const { wallet, username } = req.body;

  if (!wallet) {
    return res.status(400).json({ error: "wallet is required" });
  }

  referredWallets[wallet] = {
    wallet,
    username: username || null,
    registeredAt: new Date().toISOString()
  };

  saveReferredWallets();

  res.json({ success: true, wallet });
});

app.get("/api/referred-wallets", (req, res) => {
  res.json(referredWallets);
});

app.get("/api/wagers", (req, res) => {
  res.json(wagers);
});

app.get("/api/history", (req, res) => {
  res.json(history);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    wagers: wagers.length,
    historyWeeks: history.length,
    referredWallets: Object.keys(referredWallets).length
  });
});

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

/*
  Optional admin route to clear referred wallets
*/
app.get("/clear-referred", (req, res) => {
  const key = req.query.key;

  if (key !== process.env.ADMIN_CLEAR_KEY) {
    return res.status(403).send("Forbidden");
  }

  referredWallets = {};
  saveReferredWallets();

  res.send("Referred wallets cleared");
});

/*
  Helius webhook
  Count wager ONLY if sender wallet is already registered as referred
*/
app.post("/webhook", (req, res) => {
  console.log("Webhook hit");
  console.log("Body:", JSON.stringify(req.body, null, 2));

  const events = Array.isArray(req.body) ? req.body : [req.body];

  events.forEach((ev) => {
    const tx = extractSignature(ev);

    if (tx && processedTx.has(tx)) {
      console.log("Skipped duplicate tx:", tx);
      return;
    }

    const wallet = extractWallet(ev);
    const amount = extractAmount(ev);

    const isReferredWallet = !!referredWallets[wallet];

    console.log("Parsed webhook event:", {
      wallet,
      amount,
      isReferredWallet,
      tx
    });

    if (wallet && amount >= MIN_WAGER_SOL && isReferredWallet) {
      wagers.push({
        user: wallet,
        username: referredWallets[wallet]?.username || null,
        amount: amount,
        createdAt: new Date().toISOString(),
        tx: tx
      });

      if (tx) {
        processedTx.add(tx);
        saveProcessedTx();
      }

      saveWagers();

      console.log("New referred wager detected:", wallet, amount);
    } else {
      console.log("Wager rejected:", {
        wallet,
        amount,
        isReferredWallet,
        minimumRequired: MIN_WAGER_SOL
      });
    }
  });

  io.emit("update");
  res.sendStatus(200);
});

/*
  Weekly reset
  Sunday 12:05 AM
*/
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

  processedTx.clear();
  saveProcessedTx();

  io.emit("update");
});

io.on("connection", () => {
  console.log("User connected");
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});