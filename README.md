# CIPR — Ciphernex Stablecoin on the CipherNex Network

CIPR is a trust-backed, commercially anchored issued currency built on XRPL-aligned architecture and operated through a private CipherNex blockchain node. It is structured as an offset instrument under **12 USC 411**, **UCC 3-311**, and **UCC 3-603**, with every transaction producing an immutable evidentiary record.

---

## Project overview

| Property | Value |
|---|---|
| Token ticker | `CIPR` |
| Network name | `CipherNex` |
| Chain ID | `777287` |
| Issuer model | Cold wallet (issuing) / Hot wallet (operational) |
| Token standard | XRPL Native Issued Currency (trust line model) |
| Settlement asset | XRP (native bridge / fee asset on mainnet) |
| Reserve model | 1:1 per documented reserve entry |
| Burn mechanism | Return to issuer address — balance destroyed |
| Legal anchors | 12 USC 411 · UCC 3-311 · UCC 3-603 |

---

## Architecture

### Issuance structure

```
Cold Wallet (Issuing Address)       — air-gapped; signs mint transactions only
        │
        │  Payment (mint) — Step 4
        ▼
Hot Wallet (Operational Address)    — active circulation and distribution
        │
        │  Transfer
        ▼
Holder Accounts                     — must establish a TrustSet first (Step 3)
```

### Trust line lifecycle

```
Step 2 — AccountSet   →  configure issuer (DefaultRipple, TransferRate, Domain)
Step 3 — TrustSet     →  holder establishes trust line toward issuer
Step 4 — Payment      →  issuer mints CIPR to hot wallet / holder (reserve-backed)
Step 5 — Freeze       →  individual trust line freeze or global freeze
```

### Settlement flow (UCC discharge)

```
[Obligation Identified]
        ↓
[CIPR Tendered via Payment Transaction]
        ↓
[Block Closes — Immutable Record Created]
        ↓
[Evidence of Good-Faith Tender — UCC 3-603]
        ↓
[Obligation Discharged / Accord Satisfied — UCC 3-311]
        ↓
[Offset Recorded — Reserve Adjusted]
```

---

## Repository structure

```
src/
├── index.js                        — node startup; orchestrates all servers
├── config.js                       — network config and CIPR issuance parameters
├── blockchain/
│   ├── Block.js                    — block structure and PoW mining
│   ├── Blockchain.js               — chain management, balance, validation
│   ├── Transaction.js              — XRPL-aligned transaction (Payment / TrustSet / AccountSet)
│   ├── ContractManager.js          — wires CIPRIssuance + stablecoin TokenManager
│   ├── CIPRIssuance.js             — issuer/hot wallet, freeze controls, reserve 1:1 tracking
│   ├── TrustLine.js                — XRPL trust line model (limit, balance, freeze)
│   └── Storage.js                  — persistent chain storage (LevelDB / JSON)
├── network/
│   ├── APIServer.js                — REST API (chain, wallet, CIPR issuance routes)
│   └── P2PServer.js                — WebSocket P2P chain synchronization
├── rpc/
│   └── RPCServer.js                — JSON-RPC server (MetaMask / EVM-compatible)
├── tokens/
│   ├── Token.js                    — base ERC-20 style token model
│   ├── Stablecoin.js               — pegged stablecoin (USDT, USDTc, USDC)
│   └── TokenManager.js             — stablecoin registry
├── microservices/
│   └── ProtocolService.js          — dedicated lifecycle microservice (6-step CIPR protocol REST API)
├── server/
│   ├── api.js                      — standalone API entrypoint
│   ├── p2p.js                      — standalone P2P entrypoint
│   └── rpc.js                      — standalone RPC entrypoint
└── wallet/
    └── Wallet.js                   — wallet generation utilities
```

---

## How to run

Install dependencies:

```bash
npm install
```

Start the full node (API + P2P + RPC):

```bash
npm start
```

Optional — start services individually:

```bash
npm run start:api    # API only  — http://localhost:3001
npm run start:p2p    # P2P only  — ws://localhost:5001
npm run start:rpc    # RPC only  — http://localhost:8545
```

### Environment variables

Override any default with an environment variable before starting:

```bash
CIPR_ISSUER_ADDRESS=<cold-wallet-address>     # issuing (cold) wallet address
CIPR_HOT_WALLET_ADDRESS=<hot-wallet-address>  # operational (hot) wallet address
CIPR_MAX_SUPPLY=100000000000                  # TrustSet limit ceiling
CIPR_GENESIS_SUPPLY=100000000000              # initial mint to hot wallet
CIPR_TRANSFER_RATE=0                          # transfer fee in basis points (0 = none)
API_PORT=3001
P2P_PORT=5001
RPC_PORT=8545
PROTOCOL_PORT=3002                            # Protocol Microservice port (default 3002)
PROTOCOL_SERVICE_ENABLED=false                # Set to true to enable the Protocol Microservice
```

On first run, five genesis accounts are generated and written to `Genesis-accounts.json` with `100,000 CIPR` each. The file is reused on subsequent runs.

---

## Protocol Microservice

`src/microservices/ProtocolService.js` is a dedicated REST API that exposes the full six-step CIPR lifecycle as a standalone service. It runs alongside the main node on port **3002** (configurable via `PROTOCOL_PORT`) and shares the same `Blockchain` and `ContractManager` instances as the main node.

> **Status: optional — disabled by default.**
> The Protocol Microservice is wired into `src/index.js` but will not start unless `PROTOCOL_SERVICE_ENABLED=true` is set. A formal verification process and visual documentation layer are planned before this service is recommended for production or mainnet use. Do not enable on mainnet until that process is in place.

### Enabling the microservice

```bash
PROTOCOL_SERVICE_ENABLED=true npm start
```

Or with a custom port:

```bash
PROTOCOL_SERVICE_ENABLED=true PROTOCOL_PORT=3002 npm start
```

When disabled (default), the node logs:

```
[ProtocolService] Disabled — set PROTOCOL_SERVICE_ENABLED=true to enable
```

When enabled, the node logs:

```
[ProtocolService] CipherNex Protocol Microservice → http://localhost:3002
[ProtocolService] Full lifecycle demo            → POST http://localhost:3002/protocol/run
[ProtocolService] Interactive docs               → GET  http://localhost:3002/
```

### Purpose

The Protocol Microservice separates the step-by-step CIPR issuance protocol from the general-purpose API server. It provides:

- A guided, step-by-step interface through every phase of the CIPR lifecycle
- An automated end-to-end demo route (`POST /protocol/run`) that executes all six steps programmatically
- A service index (`GET /`) that lists every endpoint with sample request bodies and `curl` commands
- Reserve and trust line inspection endpoints independent of the main API

### Planned: verification & visual documentation

The following is scoped for a future release before this microservice is considered production-ready:

- [ ] Step-by-step verification process — each lifecycle step validated against reserve state and trust line integrity
- [ ] Visual documentation layer — interactive flow diagram showing token movement from issuer → hot wallet → holder → burn
- [ ] Audit trail report — exportable per-step receipt log tied to reserve ledger entries
- [ ] Endpoint health checks — automated assertions confirming each route returns expected structure

### CIPR lifecycle steps

| Step | Action | Route | Description |
|---|---|---|---|
| 1 | Genesis | `GET /protocol/genesis` | View genesis reserve status (minted at startup) |
| 2 | Account | `POST /protocol/account` | Create a new wallet (no trust line yet) |
| 3 | TrustSet | `POST /protocol/trustset` | Holder establishes a CIPR trust line toward the issuer |
| 4 | Issue | `POST /protocol/issue` | Issuer mints CIPR to a destination (1:1 reserve-backed) |
| 5 | Transfer | `POST /protocol/transfer` | Holder-to-holder CIPR payment |
| 6 | Settle | `POST /protocol/settle` | Holder burns CIPR; reserve retired FIFO (UCC 3-311/3-603) |

### Support routes

| Method | Route | Description |
|---|---|---|
| GET | `/` | Service index — all endpoints with sample payloads and curl commands |
| GET | `/protocol/reserve` | Reserve status: circulating supply, reserve ratio, entry count |
| GET | `/protocol/balance/:address` | Trust line balance for a holder address |
| GET | `/protocol/trustlines` | All registered trust lines |
| POST | `/protocol/run` | Automated full lifecycle demo (Genesis → Settlement in one request) |

### Example: run the full lifecycle demo

```bash
curl -X POST http://localhost:3002/protocol/run
```

This executes all six steps (genesis → account → trustset → issue → transfer → settle) and returns a structured JSON report of every step with receipts, balances, and reserve state.

### Example: step-by-step walkthrough

**Step 2 — create a wallet**
```bash
curl -X POST http://localhost:3002/protocol/account
```

**Step 3 — establish a trust line**
```bash
curl -X POST http://localhost:3002/protocol/trustset \
  -H "Content-Type: application/json" \
  -d '{ "holderAddress": "<address>", "limit": "100000000000" }'
```

**Step 4 — mint CIPR**
```bash
curl -X POST http://localhost:3002/protocol/issue \
  -H "Content-Type: application/json" \
  -d '{
    "destinationAddress": "<address>",
    "amount": "10000",
    "reserveReference": "RESERVE-DOC-2026-001",
    "memo": "12 USC 411 — issued against trust reserve"
  }'
```

**Step 6 — settle (burn)**
```bash
curl -X POST http://localhost:3002/protocol/settle \
  -H "Content-Type: application/json" \
  -d '{ "holderAddress": "<address>", "amount": "5000" }'
```

**Check reserve status**
```bash
curl http://localhost:3002/protocol/reserve
```

Each response includes a `next` field with the recommended next step, required request body, and a ready-to-run `curl` command, making it straightforward to walk through the full lifecycle manually.

---

## API reference

### Chain & wallet

| Method | Route | Description |
|---|---|---|
| GET | `/api/blocks` | All blocks |
| GET | `/api/blocks/:number` | Block by index |
| POST | `/api/transactions` | Submit a signed transaction |
| GET | `/api/transactions/pending` | Pending transaction pool |
| POST | `/api/wallet/create` | Generate new wallet |
| GET | `/api/wallet/balance/:address` | Native coin balance |
| POST | `/api/mine` | Mine pending transactions |
| GET | `/api/info` | Node info |
| POST | `/api/contracts/deploy` | Deploy a secondary token |
| GET | `/api/contracts` | List secondary tokens |

### CIPR issuance (XRPL-aligned)

| Method | Route | Description |
|---|---|---|
| POST | `/api/cipr/trustset` | Step 3 — holder establishes trust line |
| POST | `/api/cipr/issue` | Step 4 — mint CIPR from issuer (reserve-backed) |
| POST | `/api/cipr/transfer` | Transfer CIPR between two holders |
| POST | `/api/cipr/burn` | Return CIPR to issuer (destroy + retire reserve) |
| POST | `/api/cipr/freeze` | Freeze or unfreeze an individual trust line |
| POST | `/api/cipr/globalfreeze` | Global freeze / unfreeze (asfGlobalFreeze) |
| GET | `/api/cipr/reserve` | Circulating supply, reserve ratio, entry count |
| GET | `/api/cipr/balance/:address` | Trust line balance for an address |
| GET | `/api/cipr/trustlines` | All registered trust lines |

#### Example: establish trust line (Step 3)

```bash
curl -X POST http://localhost:3001/api/cipr/trustset \
  -H "Content-Type: application/json" \
  -d '{ "holderAddress": "<address>", "limit": "100000000000" }'
```

#### Example: mint CIPR (Step 4)

```bash
curl -X POST http://localhost:3001/api/cipr/issue \
  -H "Content-Type: application/json" \
  -d '{
    "destinationAddress": "<hot-wallet-address>",
    "amount": "50000",
    "reserveReference": "RESERVE-DOC-2026-001",
    "memo": "12 USC 411 — issued against trust reserve"
  }'
```

#### Example: global freeze (Step 5b)

```bash
curl -X POST http://localhost:3001/api/cipr/globalfreeze \
  -H "Content-Type: application/json" \
  -d '{ "action": "freeze" }'
```

#### Example: reserve status

```bash
curl http://localhost:3001/api/cipr/reserve
```

```json
{
  "currency": "CIPR",
  "issuer": "CIPR_ISSUER_COLD_WALLET",
  "circulatingSupply": "100000000000",
  "totalReserved": "100000000000",
  "reserveRatio": "1.0000",
  "reserveEntries": 1,
  "globalFreeze": false
}
```

---

## Transaction structure

Transactions are XRPL-aligned and carry the following fields:

| Field | Description |
|---|---|
| `transactionType` | `Payment` · `TrustSet` · `AccountSet` |
| `fromAddress` / `toAddress` | Sender and recipient |
| `amount` | Numeric (native coin) or `{ currency, issuer, value }` (issued currency) |
| `memo` | Free-text or UCC anchor string |
| `uccTender` | `"3-311"` (accord & satisfaction) · `"3-603"` (tender of payment) |
| `flags` | XRPL-style numeric flags (e.g. `1048576` = `tfSetFreeze`) |
| `limitAmount` | TrustSet limit object `{ currency, issuer, value }` |
| `setFlag` / `clearFlag` | AccountSet flag codes (e.g. `7` = `asfGlobalFreeze`) |

---

## MetaMask setup

The RPC server is EVM-compatible for MetaMask connectivity.

1. Open MetaMask → network dropdown → **Add a custom network**
2. Enter:
   - **Network Name**: `CipherNex`
   - **RPC URL**: `http://localhost:8545`
   - **Chain ID**: `777287`
   - **Currency Symbol**: `CIPR`
3. Click **Save**

### Import a genesis account

Genesis accounts are in `Genesis-accounts.json`.

1. MetaMask → account avatar → **Import Account** → **Private Key**
2. Copy a `privateKey` value (`0x…`) from `Genesis-accounts.json`
3. Paste and click **Import**

```json
{
  "address": "0xc7f328fc30eef0b9f0c93135d41dfeea0314432d",
  "privateKey": "0x303863564c20fefa5496b5e2a82a3bc77a2a2092e334d7715014bdd3af7d5c2f",
  "balance": 100000
}
```

---

## Legal framework

| Anchor | CIPR alignment |
|---|---|
| **12 USC 411** — issued against assets held in trust | Each CIPR token represents one unit of offset credit against documented reserve collateral held off-ledger |
| **UCC 3-311** — accord & satisfaction | CIPR transactions constitute good-faith tender; when accepted, obligations are satisfied in full |
| **UCC 3-603** — tender of payment | Presentment of CIPR constitutes lawful tender; refusal discharges the obligation |

Every transaction carries a UCC memo stamped automatically by the issuance controller.

---

## Notes

- Replace `CIPR_ISSUER_ADDRESS` and `CIPR_HOT_WALLET_ADDRESS` in `config.js` (or via env vars) with real XRPL-derived `rAddress` values before connecting to XRPL Mainnet.
- The private chain node provides the evidentiary backbone; XRPL Mainnet provides the public settlement layer when live.
- Genesis accounts are created on first run only and stored in `Genesis-accounts.json`. Do not commit this file to a public repository.

## License

MIT
