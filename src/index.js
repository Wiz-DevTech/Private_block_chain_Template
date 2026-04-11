/**
 * index.js — CipherNex Node Entry Point
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the orchestration layer.  It wires together every component of the
 * CipherNex network node and starts all services in the correct order.
 *
 * A running node provides:
 *   REST API (port 3001)   — Transaction submission, CIPR lifecycle, wallet ops
 *   P2P Network (port 5001) — WebSocket-based chain synchronisation with peers
 *   JSON-RPC (port 8545)   — MetaMask-compatible Ethereum RPC endpoint
 *   Protocol Microservice  — Optional dedicated lifecycle API (port 3002)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STARTUP SEQUENCE — ORDER MATTERS
 * ─────────────────────────────────────────────────────────────────────────────
 * The order of initialisation here mirrors the logical flow of the dual-ledger
 * architecture described in the CIPR framework document:
 *
 *   1. GENESIS ACCOUNTS
 *      Five secp256k1 wallets are generated (or loaded from file).  These are
 *      the initial participants in the network — they receive the genesis CIPR
 *      allocation, giving the first accounts substantive holdings from day one.
 *
 *   2. BLOCKCHAIN (Public Ledger)
 *      The immutable chain is loaded from storage or a genesis block is created.
 *      The genesis block encodes the initial CIPR distributions to all genesis
 *      account addresses — the foundational public record.
 *
 *   3. CONTRACT MANAGER (Private Trust/Reserve Ledger)
 *      ContractManager initialises CIPRIssuance (the XRPL-aligned token
 *      controller) and mints the genesis supply to the hot wallet, backed by
 *      'GENESIS-RESERVE-001'.  This is Step 1 of the CIPR lifecycle: substance
 *      is established BEFORE tokens enter distribution.
 *      Secondary stablecoins (USDT, USDTc, USDC) are also registered here.
 *
 *   4. NETWORK SERVERS (API, P2P, RPC)
 *      All three network interfaces are started.  At this point the node is
 *      live — external parties can interact with both the public blockchain
 *      (via RPC / API) and the CIPR lifecycle (via /api/cipr/* routes).
 *
 *   5. PROTOCOL MICROSERVICE (Optional)
 *      If PROTOCOL_SERVICE_ENABLED=true, the lifecycle microservice starts on
 *      port 3002, providing the step-by-step protocol API with interactive docs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUAL-LEDGER ARCHITECTURE AT STARTUP
 * ─────────────────────────────────────────────────────────────────────────────
 * After startup, the node maintains TWO interconnected ledgers:
 *
 *   PUBLIC LEDGER  (Blockchain)
 *   — Immutable block chain stored in /data/chain.json
 *   — Records native CIPR coin balances (mining rewards, genesis allocations)
 *   — Accessible via JSON-RPC (MetaMask) and GET /api/blocks
 *   — Chain integrity verifiable by anyone via Blockchain.isChainValid()
 *
 *   PRIVATE LEDGER (CIPRIssuance — held in ContractManager)
 *   — In-memory trust line registry (holderAddress → TrustLine)
 *   — In-memory reserve ledger (array of reserve entries, each 1:1 backed)
 *   — Records CIPR issued-currency balances (trust-line model)
 *   — Accessible via /api/cipr/* routes and Protocol Microservice
 *
 * Together these two ledgers represent the dual performance described in the
 * framework: CIPR satisfies both the public suretyship obligation (the block
 * chain record) and the private substantive claim (the reserve-backed trust line).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES
 * ─────────────────────────────────────────────────────────────────────────────
 *   API_PORT                    — REST API port (default: 3001)
 *   P2P_PORT                    — WebSocket P2P port (default: 5001)
 *   RPC_PORT                    — JSON-RPC port (default: 8545)
 *   PROTOCOL_PORT               — Protocol microservice port (default: 3002)
 *   PROTOCOL_SERVICE_ENABLED    — 'true' to start the lifecycle microservice
 *   P2P_PEERS                   — Comma-separated peer WebSocket URLs
 *   CIPR_ISSUER_ADDRESS         — Cold wallet address (mint authority)
 *   CIPR_HOT_WALLET_ADDRESS     — Hot wallet address (distribution)
 *   CIPR_MAX_SUPPLY             — Trust line ceiling (default: 100,000,000,000)
 *   CIPR_GENESIS_SUPPLY         — Genesis mint amount (default: 100,000,000,000)
 *   CIPR_TRANSFER_RATE          — Transfer fee in basis points (default: 0)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { bufferToHex, privateToAddress } = require('ethereumjs-util');

const Blockchain      = require('./blockchain/Blockchain');
const ContractManager = require('./blockchain/ContractManager');
const APIServer       = require('./network/APIServer');
const P2PServer       = require('./network/P2PServer');
const RPCServer       = require('./rpc/RPCServer');
const config          = require('./config');

// ── Optional Protocol Microservice ────────────────────────────────────────────
// Disabled by default to keep the base node lightweight.
// Enable with: PROTOCOL_SERVICE_ENABLED=true npm start
// When enabled, provides the full six-step lifecycle API on port 3002.
const ProtocolService = config.PROTOCOL_SERVICE_ENABLED
  ? require('./microservices/ProtocolService')
  : null;

// ── Optional Trustee Administration Services ──────────────────────────────────
// Three microservices that together form the Trustee admin layer.
// All three are disabled by default — enabled with TRUSTEE_SERVICES_ENABLED=true.
//
//   AuthService      (port 3003) — Trustee identity gate (HMAC challenge → JWT)
//   DocumentService  (port 3004) — Trust instrument record keeper
//   AdminGateway     (port 3005) — Protected admin API (wraps CIPR + documents)
//
// When enabled:
//   1. AuthService starts independently — it has no blockchain dependency.
//   2. DocumentService starts — loads any persisted records from /data/documents.json.
//   3. AdminGateway starts — receives blockchain, contractManager, documentService.
//
// IMPORTANT: Set TRUSTEE_ADMIN_SECRET and JWT_SECRET environment variables before
// enabling.  The defaults in config.js are placeholders only — not secure for
// any network-accessible deployment.
const AuthService     = config.TRUSTEE_SERVICES_ENABLED ? require('./microservices/AuthService')     : null;
const DocumentService = config.TRUSTEE_SERVICES_ENABLED ? require('./microservices/DocumentService') : null;
const AdminGateway    = config.TRUSTEE_SERVICES_ENABLED ? require('./microservices/AdminGateway')    : null;

// Genesis accounts file — persisted between node restarts so that private keys
// are available for import into MetaMask without regeneration each run.
const accountsFilePath = path.join(__dirname, '..', 'Genesis-accounts.json');

// ── Account generation helpers ────────────────────────────────────────────────

/**
 * Generate a single secp256k1 wallet (Ethereum-compatible address + private key).
 * Uses 32 bytes of cryptographically secure random entropy as the private key.
 *
 * @returns {{ address: string, privateKey: string }}
 */
function generateAccount() {
  const privateKey = crypto.randomBytes(32); // 256-bit cryptographically secure random key
  const address    = bufferToHex(privateToAddress(privateKey));
  return {
    address,                        // 0x-prefixed Ethereum-style address
    privateKey: bufferToHex(privateKey), // 0x-prefixed private key (keep secure)
  };
}

/**
 * Create five genesis accounts, each with an initial balance of 100,000 CIPR.
 *
 * These accounts are the first participants in the network.  Their CIPR
 * balance on the public ledger (native coin) traces back to the genesis block.
 * Their CIPR issued-currency balance (trust-line model) requires Step 3
 * (TrustSet) before it can be populated from the hot wallet.
 *
 * Accounts are saved to Genesis-accounts.json for reuse across node restarts.
 *
 * @returns {Array<{address, privateKey, balance}>}
 */
function createGenesisAccounts() {
  const accounts = Array.from({ length: 5 }, () => ({
    ...generateAccount(),
    balance: 100000, // initial native CIPR coin allocation per genesis account
  }));
  fs.writeFileSync(accountsFilePath, JSON.stringify(accounts, null, 2));
  return accounts;
}

/**
 * Load genesis accounts from the persisted file, if it exists.
 * Returns null on first run (file does not yet exist).
 *
 * @returns {Array|null}
 */
function getGenesisAccounts() {
  if (fs.existsSync(accountsFilePath)) {
    return JSON.parse(fs.readFileSync(accountsFilePath, 'utf8'));
  }
  return null;
}

/**
 * Print a summary of all genesis accounts to the console.
 * Only displayed on first run (when accounts are newly created).
 * The private keys are shown once — save them immediately.
 */
function printAccountSummary(accounts) {
  accounts.forEach((account, index) => {
    console.log(`Account ${index + 1}:`);
    console.log(`Address:     ${account.address}`);
    console.log(`Private Key: ${account.privateKey}`);
    console.log(`Balance:     ${account.balance} CIPR`);
    console.log('');
  });
}

/**
 * Print the node startup information, API reference, and CIPR lifecycle guide.
 * Displayed every time the node starts — serves as an interactive quick-reference.
 *
 * @param {number|string} httpPort - REST API port
 * @param {number|string} p2pPort  - WebSocket P2P port
 * @param {number|string} rpcPort  - JSON-RPC port
 */
function printStartupInfo(httpPort, p2pPort, rpcPort) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  WISDOM IGNITED BUSINESS TRUST (WIBT) — CipherNex Network Node');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  P2P Sync:      ws://localhost:${p2pPort}`);
  console.log(`  JSON-RPC:      http://localhost:${rpcPort}  (MetaMask compatible)`);
  console.log(`  REST API:      http://localhost:${httpPort}`);
  console.log(`  Chain ID:      ${config.CHAIN_ID}  (hex: 0x${Number(config.CHAIN_ID).toString(16)})`);
  console.log(`  Network:       ${config.NETWORK_NAME}`);
  console.log(`  Auto-Mining:   ${config.AUTO_MINING ? 'ENABLED' : 'DISABLED'}`);
  console.log('');
  console.log('  ─── Add to MetaMask ─────────────────────────────────────────');
  console.log(`  Network Name:  ${config.NETWORK_NAME}`);
  console.log(`  RPC URL:       http://localhost:${rpcPort}`);
  console.log(`  Chain ID:      ${config.CHAIN_ID}`);
  console.log(`  Currency:      ${config.CURRENCY_SYMBOL}`);
  console.log('');
  console.log('  ─── Blockchain API ──────────────────────────────────────────');
  console.log('  GET  /api/blocks                — All settled blocks');
  console.log('  GET  /api/blocks/:number        — Block by index');
  console.log('  POST /api/transactions          — Submit signed transaction');
  console.log('  GET  /api/transactions/pending  — Pending transaction pool');
  console.log('  POST /api/wallet/create         — Generate new wallet');
  console.log('  GET  /api/wallet/balance/:addr  — Native coin balance');
  console.log('  POST /api/mine                  — Mine pending transactions');
  console.log('  GET  /api/info                  — Node info');
  console.log('');
  console.log('  ─── CIPR Lifecycle API (XRPL-aligned) ───────────────────────');
  console.log('  Step 3:  POST /api/cipr/trustset         — Establish trust line (consent)');
  console.log('  Step 4:  POST /api/cipr/issue            — Mint CIPR (1:1 reserve-backed)');
  console.log('  Step 5:  POST /api/cipr/transfer         — Holder-to-holder transfer');
  console.log('  Step 6:  POST /api/cipr/burn             — Burn CIPR (UCC 3-311/3-603 settle)');
  console.log('           POST /api/cipr/freeze           — Individual trust line freeze');
  console.log('           POST /api/cipr/globalfreeze     — Global freeze / compliance halt');
  console.log('           GET  /api/cipr/reserve          — Reserve ratio & health');
  console.log('           GET  /api/cipr/balance/:addr    — Trust line balance');
  console.log('           GET  /api/cipr/trustlines       — All trust lines (audit view)');
  console.log('');
  console.log('  ─── CIPR Issuance State ─────────────────────────────────────');
  console.log(`  Cold Wallet:   ${config.CIPR_ISSUER_ADDRESS}`);
  console.log(`  Hot Wallet:    ${config.CIPR_HOT_WALLET_ADDRESS}`);
  console.log(`  Max Supply:    ${config.CIPR_MAX_SUPPLY} CIPR`);
  console.log(`  Transfer Fee:  ${config.CIPR_TRANSFER_RATE} bps`);
  console.log(`  UCC Anchors:   ${config.CIPR_UCC_ANCHOR}`);
  console.log('');
  console.log('  Quick Start:');
  console.log('    1. Import a genesis account private key into MetaMask');
  console.log('    2. Add the network using the RPC URL above');
  console.log('    3. Call POST /api/cipr/trustset to establish a CIPR trust line');
  console.log('    4. Call POST /api/cipr/issue to receive CIPR (supply reserveReference)');
  console.log('    5. Call POST /api/cipr/transfer to send CIPR to another holder');
  console.log('    6. Call POST /api/cipr/burn to settle and discharge the obligation');
  console.log('');
  if (config.TRUSTEE_SERVICES_ENABLED) {
    console.log('  ─── Trustee Administration (WIBT) ──────────────────────');
    console.log(`  Auth:          http://localhost:${config.DEFAULT_AUTH_PORT}   (challenge/JWT)`);
    console.log(`  Documents:     http://localhost:${config.DEFAULT_DOCUMENT_PORT}   (trust instruments)`);
    console.log(`  Admin:         http://localhost:${config.DEFAULT_ADMIN_PORT}   (protected admin API)`);
    console.log('');
    console.log('  Trustee Auth Flow:');
    console.log(`    1. GET  http://localhost:${config.DEFAULT_AUTH_PORT}/auth/challenge`);
    console.log('    2. Compute: HMAC-SHA256(nonce, TRUSTEE_ADMIN_SECRET)');
    console.log(`    3. POST http://localhost:${config.DEFAULT_AUTH_PORT}/auth/verify { address, nonce, proof }`);
    console.log(`    4. Use token → Authorization: Bearer <token> on all /admin/* routes`);
    console.log('');
    console.log(`  Dashboard:     http://localhost:${config.DEFAULT_ADMIN_PORT}/admin/dashboard`);
    console.log(`  Documents:     http://localhost:${config.DEFAULT_ADMIN_PORT}/admin/documents`);
    console.log(`  Members:       http://localhost:${config.DEFAULT_ADMIN_PORT}/admin/members`);
    console.log(`  Bill of Exch:  POST http://localhost:${config.DEFAULT_ADMIN_PORT}/admin/bill-of-exchange`);
    console.log('');
  } else {
    console.log('  ─── Trustee Administration (WIBT) ──────────────────────');
    console.log('  Disabled — set TRUSTEE_SERVICES_ENABLED=true to enable');
    console.log('  Also set: TRUSTEE_ADMIN_SECRET and JWT_SECRET env vars');
    console.log('');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP — Execute in dependency order
// ═══════════════════════════════════════════════════════════════════════════════

// ── Phase 1: Genesis Accounts ─────────────────────────────────────────────────
// Load existing accounts or generate new ones on first run.
// These accounts receive native CIPR coin in the genesis block (public ledger).
const genesisAccounts = getGenesisAccounts();

if (!genesisAccounts) {
  console.log('[CipherNex] First run detected — generating genesis accounts...');
  console.log('');
}

const accounts = genesisAccounts || createGenesisAccounts();

if (!genesisAccounts) {
  // Display accounts once — private keys will not be shown again
  printAccountSummary(accounts);
  console.log('[CipherNex] Genesis accounts saved to Genesis-accounts.json');
  console.log('');
}

// ── Phase 2: Public Ledger (Blockchain) ───────────────────────────────────────
// Load or create the chain.  Encodes genesis distributions in the genesis block.
// This is the immutable public settlement record — every mined block is final.
const blockchain = new Blockchain({
  chainId:         config.CHAIN_ID,
  networkName:     config.NETWORK_NAME,
  currencySymbol:  config.CURRENCY_SYMBOL,
  autoMining:      config.AUTO_MINING,
  difficulty:      config.MINING_DIFFICULTY,
  miningReward:    config.MINING_REWARD,
  // Genesis allocations: each account receives 100,000 native CIPR at chain start
  initialBalances: accounts.map((account) => ({
    address: account.address,
    amount:  account.balance,
  })),
});

// ── Phase 3: Private Trust/Reserve Ledger (ContractManager) ──────────────────
// Initialises CIPRIssuance (cold/hot wallet, trust lines, reserve ledger).
// Executes Step 1 of the CIPR lifecycle: genesis mint to hot wallet,
// backed by 'GENESIS-RESERVE-001'.  At this point:
//   — hot wallet trust line balance = CIPR_GENESIS_SUPPLY
//   — reserveLedger has 1 entry (genesis)
//   — reserveRatio = 1.0000 (fully backed from the start)
const contractManager = new ContractManager();

// ── Phase 4: Network Servers ──────────────────────────────────────────────────
// All three servers are instantiated and will start listening in sequence.
// At this point, external parties can interact with both ledgers.
const apiServer = new APIServer(blockchain, contractManager); // REST API
const p2pServer = new P2PServer(blockchain);                   // WebSocket P2P sync
const rpcServer = new RPCServer(blockchain, contractManager); // JSON-RPC (MetaMask)

// Resolve ports from environment variables (allows runtime configuration)
const HTTP_PORT = process.env.API_PORT  || config.DEFAULT_API_PORT; // default 3001
const P2P_PORT  = process.env.P2P_PORT  || config.DEFAULT_P2P_PORT; // default 5001
const RPC_PORT  = process.env.RPC_PORT  || config.DEFAULT_RPC_PORT; // default 8545

// Resolve initial peer list from environment variable (comma-separated WS URLs)
const P2P_PEERS = process.env.P2P_PEERS
  ? process.env.P2P_PEERS.split(',').map((peer) => peer.trim())
  : config.DEFAULT_P2P_PEERS;

// Start all three servers
apiServer.start(HTTP_PORT);  // REST API — CIPR lifecycle + blockchain routes
p2pServer.listen(P2P_PORT);  // P2P sync — chain broadcast and longest-chain consensus
if (P2P_PEERS.length > 0) {
  // Connect to configured peers on startup (multi-node network mode)
  p2pServer.connectToPeers(P2P_PEERS);
}
rpcServer.start(RPC_PORT);   // JSON-RPC — MetaMask / Ethereum tooling compatibility

// ── Phase 5: Protocol Microservice (Optional) ─────────────────────────────────
// Provides the dedicated six-step lifecycle API with interactive docs.
// Each step is a separate endpoint with legal anchors, next-step guidance,
// and ready-to-run curl commands — designed for public exploration.
if (ProtocolService) {
  const protocolService = new ProtocolService(blockchain, contractManager);
  protocolService.start(config.DEFAULT_PROTOCOL_PORT); // default 3002
} else {
  console.log('[ProtocolService] Disabled — set PROTOCOL_SERVICE_ENABLED=true to enable the lifecycle API');
}

// ── Phase 6: Trustee Administration Services (Optional) ──────────────────────
// Starts all three Trustee admin microservices when TRUSTEE_SERVICES_ENABLED=true.
//
// Startup order is important:
//   a. AuthService     — starts independently (no shared state needed)
//   b. DocumentService — loads persisted records from /data/documents.json
//   c. AdminGateway    — receives blockchain + contractManager + documentService
//
// All three must share the same JWT_SECRET value so that tokens issued by
// AuthService are accepted by AdminGateway's trusteeAuth middleware.
if (AuthService && DocumentService && AdminGateway) {
  // Phase 6a — Authentication gate (no blockchain dependency)
  const authService = new AuthService();
  authService.start(config.DEFAULT_AUTH_PORT); // default 3003

  // Phase 6b — Document record keeper (loads /data/documents.json on start)
  const documentService = new DocumentService();
  documentService.start(config.DEFAULT_DOCUMENT_PORT); // default 3004

  // Phase 6c — Protected admin API (dual-ledger + document register access)
  const adminGateway = new AdminGateway(blockchain, contractManager, documentService);
  adminGateway.start(config.DEFAULT_ADMIN_PORT); // default 3005
} else {
  console.log('[TrusteeServices] Disabled — set TRUSTEE_SERVICES_ENABLED=true to enable admin layer');
  console.log('[TrusteeServices] Also set TRUSTEE_ADMIN_SECRET and JWT_SECRET env vars');
}

// ── Startup summary ───────────────────────────────────────────────────────────
// Print the full node reference guide: ports, API routes, CIPR lifecycle steps,
// MetaMask setup instructions, and issuance state.
printStartupInfo(HTTP_PORT, P2P_PORT, RPC_PORT);
