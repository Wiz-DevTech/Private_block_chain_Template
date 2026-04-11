'use strict';

/**
 * Standalone entry point for AdminGateway + DocumentService.
 *
 * Starts the Trustee administration interface and the document record keeper
 * together — they share the same Blockchain and ContractManager context and
 * AdminGateway holds a direct reference to DocumentService.
 *
 * Usage:
 *   node src/server/admin.js
 *   ADMIN_PORT=3005 DOCUMENT_PORT=3004 TRUSTEE_ADMIN_SECRET=mysecret node src/server/admin.js
 *
 * Environment variables:
 *   ADMIN_PORT            — AdminGateway port (default: 3005)
 *   DOCUMENT_PORT         — DocumentService port (default: 3004)
 *   JWT_SECRET            — must match the secret used in AuthService
 *   TRUSTEE_ADMIN_SECRET  — must match the secret used in AuthService
 *   CIPR_ISSUER_ADDRESS   — cold wallet address
 *   CIPR_HOT_WALLET_ADDRESS
 *
 * NOTE: JWT_SECRET MUST be the same value used when starting AuthService.
 * If they differ, tokens from AuthService will be rejected by AdminGateway.
 */

const Blockchain       = require('../blockchain/Blockchain');
const ContractManager  = require('../blockchain/ContractManager');
const DocumentService  = require('../microservices/DocumentService');
const AdminGateway     = require('../microservices/AdminGateway');
const config           = require('../config');

// ── Shared blockchain and contract state ─────────────────────────────────────
// These are initialised fresh for this standalone process.  In production,
// all services share a single Blockchain instance via the main index.js.
const blockchain      = new Blockchain({
  chainId:        config.CHAIN_ID,
  networkName:    config.NETWORK_NAME,
  currencySymbol: config.CURRENCY_SYMBOL,
  autoMining:     config.AUTO_MINING,
  difficulty:     config.MINING_DIFFICULTY,
  miningReward:   config.MINING_REWARD,
});

const contractManager  = new ContractManager();

// ── DocumentService — starts first so AdminGateway can reference it ───────────
const documentService  = new DocumentService();
const documentPort     = Number(process.env.DOCUMENT_PORT) || config.DEFAULT_DOCUMENT_PORT;
documentService.start(documentPort);

// ── AdminGateway — receives both ledgers and the document service ─────────────
const adminGateway     = new AdminGateway(blockchain, contractManager, documentService);
const adminPort        = Number(process.env.ADMIN_PORT) || config.DEFAULT_ADMIN_PORT;
adminGateway.start(adminPort);
