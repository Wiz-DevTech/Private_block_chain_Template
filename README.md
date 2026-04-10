# CipherNex on the WIBT Network

This repository contains the foundation for CipherNex, the native token system for Wisdom Ignited Business Trust (WIBT) running on the WIBT Network.

## Project overview

The project is an early-stage private blockchain implementation for:
- `CIPR` native token issuance
- WIBT treasury management
- stablecoin support for `USDT`, `USDTc`, and `USDC`
- persistent chain storage and genesis block creation
- a basic blockchain and token API layer

## Current capabilities

- In-memory blockchain with proof-of-work mining
- Transaction signing and validation
- Token and stablecoin models with mint/transfer/balance support
- HTTP API for chain, token, and balance operations
- Simple P2P skeleton for chain synchronization
- Persistent storage of chain data in `data/chain.json`
- Genesis block file created in `data/genesis.json`

## Repository structure

- `src/index.js` — node startup and combined server orchestration
- `src/server/api.js` — standalone API service entrypoint
- `src/server/p2p.js` — standalone P2P service entrypoint
- `src/server/rpc.js` — standalone RPC service entrypoint
- `src/blockchain/` — blockchain, block, transaction, and storage logic
- `src/network/` — API server and P2P implementation
- `src/rpc/` — JSON-RPC server interface
- `src/tokens/` — token and stablecoin management

## How to run

Install dependencies:

```bash
npm install
```

Start the blockchain node as a combined application:

```bash
npm start
```

This runs the main entrypoint at `src/index.js` and starts API, P2P, and RPC together.

Optional standalone service entrypoints are available in `src/server/`:

```bash
npm run start:api
npm run start:p2p
npm run start:rpc
```

The default ports are:
- API server: `http://localhost:3001`
- P2P server: `ws://localhost:5001`
- RPC server: `http://localhost:8545`

The project also exposes a default RPC URL string as `http://localhost:8545` in network configuration for client compatibility.

## MetaMask Setup

### Add Network to MetaMask

1. Open MetaMask
2. Click the network dropdown (top-left)
3. Click `Add a custom network`
4. Enter:
   - **Network Name**: `WIBT Network` (or your preference)
   - **RPC URL**: `http://localhost:8545`
   - **Chain ID**: `1337`
   - **Currency Symbol**: `WIBT` (or your preference)
5. Click `Save`

### Import Genesis Accounts

Genesis accounts are stored in `Genesis-accounts.json` with **100,000 tokens** each.

1. Ensure the WIBT Network is selected in MetaMask
2. Click the account avatar (top-right)
3. Select `Import Account`
4. Choose `Private Key` as the import method
5. Copy a **privateKey** value from `Genesis-accounts.json` (the `0x...` string)
6. Paste it into MetaMask and click `Import`

**Example:**
```json
{
  "address": "0xc7f328fc30eef0b9f0c93135d41dfeea0314432d",
  "privateKey": "0x303863564c20fefa5496b5e2a82a3bc77a2a2092e334d7715014bdd3af7d5c2f",
  "balance": 100000
}
```

Import `0x303863564c20fefa5496b5e2a82a3bc77a2a2092e334d7715014bdd3af7d5c2f` as the private key.

The imported account will show the balance on the WIBT Network.

## Notes

- The project is not yet integrated with XRPL or NFT document tracking.
- The current implementation is a custom prototype and not a production blockchain.
- Genesis accounts are created on first run and saved to `Genesis-accounts.json`.

## License

MIT
