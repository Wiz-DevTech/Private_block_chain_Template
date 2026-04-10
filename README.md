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
CIPR_MAX_SUPPLY=1000000000                    # TrustSet limit ceiling
CIPR_GENESIS_SUPPLY=100000000                 # initial mint to hot wallet
CIPR_TRANSFER_RATE=0                          # transfer fee in basis points (0 = none)
API_PORT=3001
P2P_PORT=5001
RPC_PORT=8545
```

On first run, five genesis accounts are generated and written to `Genesis-accounts.json` with `100,000 CIPR` each. The file is reused on subsequent runs.

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
  -d '{ "holderAddress": "<address>", "limit": "1000000000" }'
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
  "circulatingSupply": "100000000",
  "totalReserved": "100000000",
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
