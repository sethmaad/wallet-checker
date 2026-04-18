# 🔐 Wallet Checker — BIP39 Address Verifier + Multi-Chain Activity

A **local-only** tool that:
1. Validates a BIP39 mnemonic phrase
2. Derives EVM (Ethereum) and Bitcoin addresses via BIP44 standard (indexes 0–19)
3. Checks if a given wallet address matches any derived address
4. If matched, queries Ethereum, BSC, and Polygon for balance + transaction count

---

## ⚠️ Security Notice

> **NEVER enter real wallet seed phrases on any website you don't fully control.**
>
> This tool is designed for **local use only**. Your mnemonic is processed entirely
> inside the local Node.js process — it is **never** forwarded to any external API.
> Only the final wallet *address* is sent to RPC endpoints.

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
cd wallet-checker
npm install
```

### 2. Start the server

```bash
npm start
```

Or with auto-reload during development:

```bash
npm run dev   # requires: npm install -g nodemon
```

### 3. Open in browser

```
http://localhost:3000
```

---

## 📁 Project Structure

```
wallet-checker/
├── server.js          # Express backend — all mnemonic logic runs here
├── package.json
├── public/
│   └── index.html     # Frontend UI
└── README.md
```

---

## 🔧 How It Works

### Mnemonic Validation
- Uses `bip39.validateMnemonic()` — checks wordlist compliance

### Address Derivation
| Chain   | Path                  | Library         |
|---------|-----------------------|-----------------|
| EVM     | `m/44'/60'/0'/0/i`    | ethers.js v6    |
| Bitcoin | `m/44'/0'/0'/0/i`     | bitcoinjs-lib   |

Derives **20 addresses** (index 0–19) for each chain type.

### Match Check
- Normalises addresses to lowercase before comparing (handles EIP-55 checksums)
- Returns the matching path + index on success

### Chain Activity (EVM match only)
Queries 3 networks in parallel via JSON-RPC:
- **Ethereum** — Infura mainnet
- **BSC** — Binance public RPC
- **Polygon** — Infura polygon mainnet

Returns: balance, transaction count, active status (balance > 0 OR txCount > 0)

---

## 📦 Dependencies

| Package          | Purpose                         |
|------------------|---------------------------------|
| `express`        | HTTP server                     |
| `ethers` v6      | EVM address derivation + RPC    |
| `bip39`          | Mnemonic validation + seed gen  |
| `bip32`          | HD wallet path derivation       |
| `bitcoinjs-lib`  | Bitcoin P2PKH address gen       |
| `tiny-secp256k1` | Elliptic curve (required by bip32/bitcoinjs-lib) |
| `cors`           | Cross-origin headers            |

---

## 🛡️ Security Design

- Mnemonic enters `POST /api/check` body over localhost only
- It is **never** stored, logged, or forwarded
- Only the derived address string hits external RPCs
- No database, no sessions, no persistence

---

## 🌐 RPC Endpoints Used

| Network  | Endpoint                                      |
|----------|-----------------------------------------------|
| Ethereum | `https://mainnet.infura.io/v3/<KEY>`          |
| BSC      | `https://bsc-dataseed1.binance.org/`          |
| Polygon  | `https://polygon-mainnet.infura.io/v3/<KEY>`  |
