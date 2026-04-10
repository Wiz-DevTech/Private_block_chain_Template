const TokenManager = require('../tokens/TokenManager');
const CIPRIssuance = require('./CIPRIssuance');
const config = require('../config');

class ContractManager {
  constructor() {
    this.tokenManager = new TokenManager();

    // XRPL-aligned CIPR issuance controller (cold/hot wallet architecture)
    this.ciprIssuance = new CIPRIssuance({
      issuerAddress:    config.CIPR_ISSUER_ADDRESS,
      hotWalletAddress: config.CIPR_HOT_WALLET_ADDRESS,
      currency:         config.CURRENCY_SYMBOL,
      maxSupply:        config.CIPR_MAX_SUPPLY,
      transferRate:     config.CIPR_TRANSFER_RATE,
    });

    this.initializeContracts();
  }

  initializeContracts() {
    // CIPR — managed via CIPRIssuance (trust line / issued-currency model)
    // Initial hot-wallet allocation backed by genesis reserve documentation
    this.ciprIssuance.issue(
      config.CIPR_HOT_WALLET_ADDRESS,
      config.CIPR_GENESIS_SUPPLY,
      'GENESIS-RESERVE-001',
      '12 USC 411 — genesis reserve allocation; UCC 3-603 tender established'
    );

    // Secondary tokens remain in the simple TokenManager (ERC-20 style)
    this.tokenManager.createStablecoin('USD Tether',      'USDT',  'USD', 6);
    this.tokenManager.createStablecoin('USD Tether Coin', 'USDTc', 'USD', 6);
    this.tokenManager.createStablecoin('USD Coin',        'USDC',  'USD', 6);
  }
}

module.exports = ContractManager;
