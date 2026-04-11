/**
 * ContractManager — the trust registry that initialises and manages all
 * token instruments on the CipherNex network.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCEPTUAL FOUNDATION — Substance Before Circulation
 * ─────────────────────────────────────────────────────────────────────────────
 * In the existing system, the U.S. Treasury issues bonds; the Federal Reserve
 * credits the Treasury's account with FRNs created electronically; there is no
 * pre-existing substance — the "backing" is the government's future ability to
 * extract tax revenues from the people.  The government "brings no substance of
 * its own — it hypothecates the value of the people."
 *
 * ContractManager reverses this flow:
 *
 *   SUBSTANCE FIRST — The genesis reserve entry ('GENESIS-RESERVE-001') is
 *   recorded in the reserve ledger BEFORE any CIPR enters circulation.  The
 *   backing exists before the token — not as a promise of future payment, but
 *   as a documented reference to the trust instrument that authorises issuance.
 *
 *   ISSUER ACCOUNTABILITY — The cold wallet issuer is identified at construction.
 *   The issuance controller (CIPRIssuance) is bound to that wallet.  Mint
 *   authority is fixed, auditable, and cannot be transferred without explicit
 *   reconfiguration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INSTRUMENTS MANAGED
 * ─────────────────────────────────────────────────────────────────────────────
 *   PRIMARY — CIPR (CipherNex Coin)
 *     Managed via CIPRIssuance using the XRPL trust-line / issued-currency model.
 *     Every unit is 1:1 reserve-backed, UCC-anchored, and settlement-final.
 *     This is the private bond instrument described in the framework document.
 *
 *   SECONDARY — USDT, USDTc, USDC (stablecoins)
 *     Managed via TokenManager using the simpler ERC-20 style balance model.
 *     These are complementary instruments for USD-pegged liquidity.
 *     They do not carry UCC legal anchors or reserve entries by default.
 */

const TokenManager  = require('../tokens/TokenManager');
const CIPRIssuance  = require('./CIPRIssuance');
const config        = require('../config');

class ContractManager {
  /**
   * Initialise the token registry.
   *
   * Construction sequence:
   *   1. Create the TokenManager (secondary token registry)
   *   2. Create the CIPRIssuance controller (primary instrument, XRPL-aligned)
   *   3. Call initializeContracts() — executes the genesis allocation and
   *      registers all secondary stablecoins
   *
   * After construction, this.ciprIssuance is ready to serve Steps 3–6 of
   * the CIPR lifecycle, and this.tokenManager holds the stablecoin registry.
   */
  constructor() {
    // ── Secondary token registry (ERC-20 style) ──────────────────────────────
    // Handles USDT, USDTc, USDC — complementary USD-pegged instruments.
    // Does not carry trust-line or reserve-backing mechanics.
    this.tokenManager = new TokenManager();

    // ── Primary CIPR issuance controller (XRPL-aligned) ─────────────────────
    // Binds to the cold wallet (mint authority) and hot wallet (operational).
    // The trust-line registry, reserve ledger, and circulating supply are all
    // maintained inside this controller for the lifetime of the node.
    this.ciprIssuance = new CIPRIssuance({
      issuerAddress:    config.CIPR_ISSUER_ADDRESS,    // cold wallet — mint authority
      hotWalletAddress: config.CIPR_HOT_WALLET_ADDRESS, // hot wallet — distribution
      currency:         config.CURRENCY_SYMBOL,        // 'CIPR'
      maxSupply:        config.CIPR_MAX_SUPPLY,        // trust line ceiling / hard cap
      transferRate:     config.CIPR_TRANSFER_RATE,     // basis points (0 = feeless)
    });

    // Execute genesis allocation and stablecoin registration
    this.initializeContracts();
  }

  /**
   * Execute Step 1 of the CIPR lifecycle: genesis reserve allocation.
   *
   * ── CIPR Genesis Mint ────────────────────────────────────────────────────
   * The full genesis supply is minted from the cold wallet to the hot wallet,
   * backed by the 'GENESIS-RESERVE-001' document reference.
   *
   * Why 'GENESIS-RESERVE-001' matters:
   *   This reference ties the initial CIPR supply to a specific trust
   *   instrument — the Wisdom Ignited Business Trust reserve document.
   *   Unlike a Treasury bond (where the backing is "the full faith and credit
   *   of the United States" — i.e., future tax extraction), this reference
   *   points to an existing, documented asset: the trust corpus itself.
   *
   *   The legal anchor embedded in the memo ('12 USC 411 | UCC 3-603') records
   *   that this genesis issuance is made against trust reserves, not as a
   *   liability — establishing the instrument as substantive equity from day one.
   *
   * After this call:
   *   — hot wallet trust line balance = CIPR_GENESIS_SUPPLY
   *   — reserveLedger has 1 entry: { reference: 'GENESIS-RESERVE-001', amount: GENESIS_SUPPLY }
   *   — circulatingSupply = GENESIS_SUPPLY
   *   — reserveRatio = 1.0000 (perfectly backed)
   *
   * ── Secondary Stablecoins ────────────────────────────────────────────────
   * Three USD-pegged stablecoins are registered for complementary liquidity.
   * These use the simpler ERC-20 balance model — no trust lines or reserve
   * backing required for stablecoin minting (handled separately).
   */
  initializeContracts() {
    // ── Step 1 — CIPR Genesis Allocation ─────────────────────────────────────
    // Mint the entire genesis supply to the hot wallet, backed by the genesis
    // reserve document.  This is the first substantive act of the ledger.
    this.ciprIssuance.issue(
      config.CIPR_HOT_WALLET_ADDRESS,   // destination: hot wallet (distribution address)
      config.CIPR_GENESIS_SUPPLY,       // amount: full genesis supply (e.g. 100,000,000,000)
      'GENESIS-RESERVE-001',            // reserve reference: trust corpus document
      '12 USC 411 — genesis reserve allocation; UCC 3-603 tender established'
      // Legal memo: CIPR is issued against the trust reserve, not as a liability.
      // The genesis allocation IS the substance — the instrument is backed the
      // moment it is created, not deferred to future performance.
    );

    // ── Secondary token registration ─────────────────────────────────────────
    // These stablecoins provide USD-denominated liquidity within the network.
    // They are distinct instruments from CIPR and carry different mechanics.

    // USD Tether — standard USD-pegged stablecoin (6 decimal precision)
    this.tokenManager.createStablecoin('USD Tether',      'USDT',  'USD', 6);
    // USD Tether Coin — alternate USD tether variant (6 decimal precision)
    this.tokenManager.createStablecoin('USD Tether Coin', 'USDTc', 'USD', 6);
    // USD Coin — regulated USD stablecoin equivalent (6 decimal precision)
    this.tokenManager.createStablecoin('USD Coin',        'USDC',  'USD', 6);
  }
}

module.exports = ContractManager;
