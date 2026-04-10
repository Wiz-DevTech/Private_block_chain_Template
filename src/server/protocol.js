'use strict';

/**
 * Standalone entry point for the CipherNex Protocol Microservice.
 *
 * Usage:
 *   node src/server/protocol.js
 *   PROTOCOL_PORT=3002 node src/server/protocol.js
 *
 * Runs independently of the main API server (3001), RPC server (8545),
 * and P2P server (5001). Shares no network state — each instance
 * initialises its own Blockchain + ContractManager (genesis included).
 */

const Blockchain      = require('../blockchain/Blockchain');
const ContractManager = require('../blockchain/ContractManager');
const ProtocolService = require('../microservices/ProtocolService');
const config          = require('../config');

const blockchain = new Blockchain({
  chainId:       config.CHAIN_ID,
  networkName:   config.NETWORK_NAME,
  currencySymbol: config.CURRENCY_SYMBOL,
  autoMining:    config.AUTO_MINING,
  difficulty:    config.MINING_DIFFICULTY,
  miningReward:  config.MINING_REWARD,
});

const contractManager = new ContractManager();
const service         = new ProtocolService(blockchain, contractManager);
const port            = Number(process.env.PROTOCOL_PORT) || 3002;

service.start(port);
