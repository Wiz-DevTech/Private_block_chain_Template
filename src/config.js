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
  DEFAULT_API_PORT:      3001,
  DEFAULT_P2P_PORT:      5001,
  DEFAULT_RPC_PORT:      8545,
  DEFAULT_RPC_URL:       'http://localhost:8545',
  DEFAULT_P2P_PEERS:     [],

  // -------------------------------------------------------------------------
  // Protocol Microservice (ProtocolService)
  //
  // Disabled by default. Set PROTOCOL_SERVICE_ENABLED=true to activate.
  // When enabled, the full six-step CIPR lifecycle REST API is available
  // on DEFAULT_PROTOCOL_PORT. Verification tooling and visual docs are
  // planned — do not enable on mainnet until that process is in place.
  // -------------------------------------------------------------------------
  PROTOCOL_SERVICE_ENABLED: process.env.PROTOCOL_SERVICE_ENABLED === 'true',
  DEFAULT_PROTOCOL_PORT:    Number(process.env.PROTOCOL_PORT || 3002),

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

  // -------------------------------------------------------------------------
  // Trustee Administration Services
  //
  // Three microservices that together form the Trustee admin layer:
  //
  //   AuthService      (port 3003) — HMAC challenge-response authentication;
  //                                  issues Trustee JWTs
  //   DocumentService  (port 3004) — Trust instrument record keeper;
  //                                  manages bills of exchange, bonds, pledges
  //   AdminGateway     (port 3005) — Protected admin API; wraps CIPR issuance
  //                                  with authentication and document linking
  //
  // All three are disabled by default.
  // Enable with: TRUSTEE_SERVICES_ENABLED=true npm start
  // -------------------------------------------------------------------------
  TRUSTEE_SERVICES_ENABLED: process.env.TRUSTEE_SERVICES_ENABLED === 'true',
  DEFAULT_AUTH_PORT:         Number(process.env.AUTH_PORT     || 3003),
  DEFAULT_DOCUMENT_PORT:     Number(process.env.DOCUMENT_PORT || 3004),
  DEFAULT_ADMIN_PORT:        Number(process.env.ADMIN_PORT    || 3005),

  // ── JWT configuration ────────────────────────────────────────────────────
  // JWT_SECRET: the HMAC key used to sign and verify all Trustee tokens.
  // MUST be set to a high-entropy value in production via the environment.
  // The same secret must be used by AuthService AND AdminGateway — if they
  // run in separate processes, both must receive the same JWT_SECRET value.
  JWT_SECRET:     process.env.JWT_SECRET     || 'WIBT-CHANGE-THIS-IN-PRODUCTION',

  // JWT_EXPIRES_IN: token lifetime in seconds.  Default: 3600 (1 hour).
  // Trustees should refresh before expiry via POST /auth/refresh.
  JWT_EXPIRES_IN: Number(process.env.JWT_EXPIRES_IN || 3600),

  // ── Trustee admin secret ─────────────────────────────────────────────────
  // TRUSTEE_ADMIN_SECRET: the HMAC key used in the challenge-response auth flow.
  // The client computes HMAC-SHA256(nonce, TRUSTEE_ADMIN_SECRET) as proof of
  // identity.  MUST be set via environment variable before the node starts.
  // Never log or expose this value.
  TRUSTEE_ADMIN_SECRET: process.env.TRUSTEE_ADMIN_SECRET || 'WIBT-TRUSTEE-SECRET-CHANGE-ME',
};
