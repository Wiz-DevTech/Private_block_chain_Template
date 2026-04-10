module.exports = {
  // -------------------------------------------------------------------------
  // Chain / network identity
  // -------------------------------------------------------------------------
  NETWORK_NAME:    'CipherNex',
  CHAIN_ID:        777287,
  CURRENCY_SYMBOL: 'CIPR',

  // -------------------------------------------------------------------------
  // Mining (internal PoW chain — used for block finality on the private node)
  // -------------------------------------------------------------------------
  AUTO_MINING:      true,
  MINING_DIFFICULTY: 2,
  MINING_REWARD:    100,

  // -------------------------------------------------------------------------
  // Server ports
  // -------------------------------------------------------------------------
  DEFAULT_API_PORT: 3001,
  DEFAULT_P2P_PORT: 5001,
  DEFAULT_RPC_PORT: 8545,
  DEFAULT_RPC_URL:  'http://localhost:8545',
  DEFAULT_P2P_PEERS: [],

  // -------------------------------------------------------------------------
  // CIPR — XRPL-aligned issuance structure
  //
  // ISSUER (cold wallet)  — air-gapped signing address; never holds circulating tokens
  // HOT WALLET            — operational / distribution address
  //
  // Replace placeholder values with real XRPL-derived addresses before mainnet.
  // -------------------------------------------------------------------------

  // Cold wallet (Issuing Address) — AccountSet asfDefaultRipple must be set
  CIPR_ISSUER_ADDRESS:    process.env.CIPR_ISSUER_ADDRESS    || 'CIPR_ISSUER_COLD_WALLET',

  // Hot wallet (Operational / Distribution Address)
  CIPR_HOT_WALLET_ADDRESS: process.env.CIPR_HOT_WALLET_ADDRESS || 'CIPR_HOT_OPERATIONAL_WALLET',

  // Maximum supply ceiling — mirrors TrustSet LimitAmount value (Step 3)
  CIPR_MAX_SUPPLY: process.env.CIPR_MAX_SUPPLY || '100000000000',

  // Genesis allocation issued to hot wallet at node startup (backed by GENESIS-RESERVE-001)
  CIPR_GENESIS_SUPPLY: process.env.CIPR_GENESIS_SUPPLY || '100000000000',

  // Transfer fee in basis points (0 = no fee; 100 = 1%)
  // Maps to XRPL TransferRate field on the issuer AccountSet
  CIPR_TRANSFER_RATE: Number(process.env.CIPR_TRANSFER_RATE || 0),

  // -------------------------------------------------------------------------
  // CIPR — Legal / UCC anchors (informational — stamped into transaction memos)
  // -------------------------------------------------------------------------
  // 12 USC 411  — issued against assets held in trust
  // UCC 3-311   — accord & satisfaction tender
  // UCC 3-603   — tender of payment / obligation discharge
  CIPR_UCC_ANCHOR: '12 USC 411 | UCC 3-311 | UCC 3-603',
};
