/**
 * Wallet Checker — server.js
 * ============================================================
 * Local-only tool that:
 *  1. Validates a BIP39 mnemonic phrase
 *  2. Derives EVM + Bitcoin addresses (BIP44, indexes 0-19)
 *  3. Checks if the user-supplied address matches any derived one
 *  4. If matched: queries Ethereum, BSC, and Polygon for balance/tx count
 *
 * SECURITY NOTICE:
 *  - The mnemonic is NEVER forwarded to any external API
 *  - All derivation logic runs 100% locally inside this process
 *  - Only the final wallet ADDRESS is sent to RPC endpoints
 * ============================================================
 */

"use strict";

const express = require("express");
const cors    = require("cors");
const path    = require("path");

// BIP39 / BIP32
const bip39 = require("bip39");
const { BIP32Factory } = require("bip32");
const ecc = require("tiny-secp256k1");
const bip32 = BIP32Factory(ecc);

// Bitcoin address generation
const bitcoin = require("bitcoinjs-lib");
bitcoin.initEccLib(ecc);

// Ethers v6
const { ethers } = require("ethers");

// ── Configuration ──────────────────────────────────────────────────────────────

const INFURA_KEY = "39d30b29fe154e95bf02210b8b93bcbb";

const NETWORKS = {
  ethereum: {
    name: "Ethereum",
    symbol: "ETH",
    rpc: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 1,
  },
  bsc: {
    name: "BNB Smart Chain",
    symbol: "BNB",
    rpc: "https://bsc-dataseed1.binance.org/",
    chainId: 56,
  },
  polygon: {
    name: "Polygon",
    symbol: "MATIC",
    rpc: "https://polygon-mainnet.infura.io/v3/" + INFURA_KEY,
    chainId: 137,
  },
};

const DERIVE_COUNT = 20; // indexes 0 → 19

// ── Express setup ──────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Address derivation helpers ─────────────────────────────────────────────────

/**
 * Derive Ethereum/EVM addresses from a seed buffer.
 * Path: m/44'/60'/0'/0/i
 */
function deriveEVMAddresses(seedBuffer) {
  const root = bip32.fromSeed(seedBuffer);
  const addresses = [];

  for (let i = 0; i < DERIVE_COUNT; i++) {
    const child = root.derivePath(`m/44'/60'/0'/0/${i}`);
    // ethers v6: compress the public key and derive address
    const pubKeyBytes = child.publicKey; // 33-byte compressed
    const address = ethers.computeAddress(pubKeyBytes);
    addresses.push({ index: i, address, path: `m/44'/60'/0'/0/${i}` });
  }

  return addresses;
}

/**
 * Derive Bitcoin P2PKH addresses from a seed buffer.
 * Path: m/44'/0'/0'/0/i
 */
function deriveBTCAddresses(seedBuffer) {
  const root = bip32.fromSeed(seedBuffer);
  const addresses = [];

  for (let i = 0; i < DERIVE_COUNT; i++) {
    const child = root.derivePath(`m/44'/0'/0'/0/${i}`);
    const { address } = bitcoin.payments.p2pkh({
      pubkey: Buffer.from(child.publicKey),
      network: bitcoin.networks.bitcoin,
    });
    addresses.push({ index: i, address, path: `m/44'/0'/0'/0/${i}` });
  }

  return addresses;
}

// ── Chain activity helpers ─────────────────────────────────────────────────────

/**
 * Query one EVM-compatible network for balance + tx count.
 * Returns null on any RPC error so the caller can handle gracefully.
 */
async function queryEVMNetwork(networkKey, address) {
  const cfg = NETWORKS[networkKey];

  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpc, {
      chainId: cfg.chainId,
      name: networkKey,
    });

    // Race both calls; if either times out we catch below
    const [rawBalance, txCount] = await Promise.all([
      provider.getBalance(address),
      provider.getTransactionCount(address),
    ]);

    const balanceEther = ethers.formatEther(rawBalance);
    const active = rawBalance > 0n || txCount > 0;

    return {
      network:   cfg.name,
      symbol:    cfg.symbol,
      balance:   balanceEther,
      txCount,
      active,
      error:     null,
    };
  } catch (err) {
    return {
      network:  cfg.name,
      symbol:   cfg.symbol,
      balance:  null,
      txCount:  null,
      active:   false,
      error:    err.message || "RPC error",
    };
  }
}

// ── Main API endpoint ──────────────────────────────────────────────────────────

/**
 * POST /api/check
 * Body: { address: string, mnemonic: string }
 *
 * The mnemonic is processed locally and NEVER forwarded anywhere.
 */
app.post("/api/check", async (req, res) => {
  const { address, mnemonic } = req.body;

  // ── Input validation ──────────────────────────────────────────────────────

  if (!address || typeof address !== "string" || address.trim() === "") {
    return res.status(400).json({ error: "Wallet address is required." });
  }

  if (!mnemonic || typeof mnemonic !== "string" || mnemonic.trim() === "") {
    return res.status(400).json({ error: "Mnemonic phrase is required." });
  }

  const cleanMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  const cleanAddress  = address.trim();

  // ── Validate mnemonic (BIP39) ────────────────────────────────────────────

  if (!bip39.validateMnemonic(cleanMnemonic)) {
    return res.status(400).json({
      error: "Invalid mnemonic phrase. Please check your word list and spacing.",
    });
  }

  // ── Derive seed (local only — never leaves this process) ─────────────────

  const seedBuffer = await bip39.mnemonicToSeed(cleanMnemonic);

  // ── Derive addresses ──────────────────────────────────────────────────────

  const evmAddresses = deriveEVMAddresses(seedBuffer);
  const btcAddresses = deriveBTCAddresses(seedBuffer);

  // ── Match check ───────────────────────────────────────────────────────────

  // Normalize to lowercase for EVM comparison (checksummed vs non-checksummed)
  const addrLower = cleanAddress.toLowerCase();

  const evmMatch = evmAddresses.find(
    (a) => a.address.toLowerCase() === addrLower
  );
  const btcMatch = btcAddresses.find((a) => a.address === cleanAddress);

  const matched    = evmMatch || btcMatch || null;
  const matchType  = evmMatch ? "EVM" : btcMatch ? "Bitcoin" : null;
  const isMatch    = !!matched;

  // ── If no match, return early ─────────────────────────────────────────────

  if (!isMatch) {
    return res.json({
      match:       false,
      matchType:   null,
      matchedPath: null,
      matchIndex:  null,
      chainData:   null,
      // Include a few sample derived addresses so the user can debug
      sampleEVM:   evmAddresses.slice(0, 3).map((a) => a.address),
      sampleBTC:   btcAddresses.slice(0, 3).map((a) => a.address),
    });
  }

  // ── Query chain activity ──────────────────────────────────────────────────

  let chainData = null;

  if (matchType === "EVM") {
    // Query all three networks in parallel for speed
    const [eth, bsc, polygon] = await Promise.all([
      queryEVMNetwork("ethereum", cleanAddress),
      queryEVMNetwork("bsc",      cleanAddress),
      queryEVMNetwork("polygon",  cleanAddress),
    ]);
    chainData = [eth, bsc, polygon];
  }
  // Bitcoin RPC queries are omitted (no standard Infura-like free endpoint);
  // a note is returned instead.

  return res.json({
    match:       true,
    matchType,
    matchedPath: matched.path,
    matchIndex:  matched.index,
    chainData,
    btcNote:
      matchType === "Bitcoin"
        ? "Bitcoin chain queries require a dedicated node/API (e.g. BlockCypher). Balance check skipped."
        : null,
  });
});

// ── Health check ───────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🔐 Wallet Checker running at http://localhost:${PORT}`);
  console.log("   ⚠️  For LOCAL use only. Never deploy with real secrets.\n");
});
