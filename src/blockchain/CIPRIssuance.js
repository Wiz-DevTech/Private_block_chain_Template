/**
 * CIPRIssuance — XRPL-aligned CIPR issuance controller.
 *
 * Models the XRPL cold-wallet / hot-wallet architecture described in the
 * CIPR framework document:
 *
 *   Cold Wallet (Issuing Address)  — signs mint transactions, kept offline
 *   Hot Wallet (Operational Address) — handles day-to-day circulation
 *
 * Lifecycle mirrors XRPL steps 2-5:
 *   AccountSet → TrustSet → Payment (mint) → Freeze controls
 *
 * Reserve model: 1 CIPR minted per 1 unit of documented reserve entry.
 * Burn: tokens returned to issuer address are destroyed (balance zeroed).
 *
 * Legal anchors carried in transaction memos:
 *   12 USC 411  — issued against reserve held in trust
 *   UCC 3-311   — accord & satisfaction tender
 *   UCC 3-603   — tender of payment / discharge evidence
 */
const TrustLine = require('./TrustLine');

class CIPRIssuance {
  /**
   * @param {object} config
   * @param {string} config.issuerAddress    - Cold wallet address (issuing account)
   * @param {string} config.hotWalletAddress - Hot wallet / operational address
   * @param {string} config.currency         - Token ticker (default "CIPR")
   * @param {string} config.maxSupply        - Trust line ceiling (default "1000000000")
   * @param {number} config.transferRate     - Basis points transfer fee (default 0)
   */
  constructor(config = {}) {
    this.issuerAddress  = config.issuerAddress  || 'CIPR_ISSUER_COLD_WALLET';
    this.hotWalletAddress = config.hotWalletAddress || 'CIPR_HOT_OPERATIONAL_WALLET';
    this.currency       = config.currency       || 'CIPR';
    this.maxSupply      = config.maxSupply      || '1000000000';
    this.transferRate   = config.transferRate   || 0;   // 0 = no fee

    // AccountSet flags (XRPL asfDefaultRipple = 8, asfGlobalFreeze = 7)
    this.defaultRipple  = true;   // asfDefaultRipple — enables token flow between accounts
    this.globalFreeze   = false;  // asfGlobalFreeze  — halts all issuance when true

    // Trust line registry: key = holder address
    this.trustLines = {};

    // Reserve ledger: each entry maps a reserve reference → amount minted
    this.reserveLedger = [];

    // Total CIPR currently in circulation (excludes burned / returned)
    this.circulatingSupply = '0';

    // Establish the hot wallet's trust line automatically at init
    this._initHotWalletTrustLine();
  }

  // ---------------------------------------------------------------------------
  // Step 3 — TrustSet: holder establishes a trust line toward issuer
  // ---------------------------------------------------------------------------

  /**
   * Register a new trust line for a holder account.
   * Must be called before the issuer can send CIPR to that account.
   *
   * @param {string} holderAddress - Account setting up the trust line
   * @param {string} limit         - Max CIPR the holder will accept
   * @returns {TrustLine}
   */
  trustSet(holderAddress, limit = this.maxSupply) {
    if (this.trustLines[holderAddress]) {
      throw new Error(`Trust line already exists for ${holderAddress}`);
    }
    const tl = new TrustLine(this.currency, this.issuerAddress, holderAddress, limit);
    this.trustLines[holderAddress] = tl;
    return tl;
  }

  // ---------------------------------------------------------------------------
  // Step 4 — Payment (mint): issuer → hot wallet (or any trust-line holder)
  // ---------------------------------------------------------------------------

  /**
   * Issue (mint) CIPR from the issuer to a destination account.
   * Requires a trust line to exist for the destination.
   * A reserve reference must be supplied — enforces 1:1 reserve backing.
   *
   * @param {string} destinationAddress - Must have an existing trust line
   * @param {string} amount             - Amount of CIPR to issue
   * @param {string} reserveReference   - Document ID / reference backing this mint
   * @param {string} [memo]             - Optional UCC/legal memo
   * @returns {object} mint receipt
   */
  issue(destinationAddress, amount, reserveReference, memo = '') {
    this._assertNotGloballyFrozen();

    const tl = this._getTrustLine(destinationAddress);
    tl.credit(amount);

    const reserveEntry = {
      reference: reserveReference,
      amount,
      destination: destinationAddress,
      timestamp: Date.now(),
      memo: memo || this._defaultMemo('mint', amount),
    };
    this.reserveLedger.push(reserveEntry);
    this.circulatingSupply = String(parseFloat(this.circulatingSupply) + parseFloat(amount));

    return {
      transactionType: 'Payment',
      account: this.issuerAddress,
      destination: destinationAddress,
      amount: { currency: this.currency, issuer: this.issuerAddress, value: amount },
      reserveEntry,
      newCirculatingSupply: this.circulatingSupply,
    };
  }

  /**
   * Transfer CIPR between two non-issuer accounts (both must hold trust lines).
   * Respects global freeze and individual trust line freeze.
   *
   * @param {string} fromAddress
   * @param {string} toAddress
   * @param {string} amount
   * @param {string} [memo]
   * @returns {object} transfer receipt
   */
  transfer(fromAddress, toAddress, amount, memo = '') {
    this._assertNotGloballyFrozen();

    const fromTL = this._getTrustLine(fromAddress);
    const toTL   = this._getTrustLine(toAddress);

    // Apply transfer fee (basis points, 0 = no fee)
    const fee  = this.transferRate > 0 ? parseFloat(amount) * (this.transferRate / 10000) : 0;
    const net  = String(parseFloat(amount) - fee);

    fromTL.debit(amount);
    toTL.credit(net);

    return {
      transactionType: 'Payment',
      from: fromAddress,
      to: toAddress,
      grossAmount: amount,
      fee: String(fee),
      netAmount: net,
      currency: this.currency,
      memo: memo || this._defaultMemo('transfer', amount),
      timestamp: Date.now(),
    };
  }

  /**
   * Burn: holder returns CIPR to the issuer address — tokens are destroyed.
   * XRPL native behavior: payment to issuer zeroes the balance on their side.
   *
   * @param {string} holderAddress
   * @param {string} amount
   * @param {string} [memo]
   * @returns {object} burn receipt
   */
  burn(holderAddress, amount, memo = '') {
    const tl = this._getTrustLine(holderAddress);
    tl.debit(amount);

    this.circulatingSupply = String(Math.max(0, parseFloat(this.circulatingSupply) - parseFloat(amount)));

    // Retire the corresponding reserve entry (FIFO)
    this._retireReserve(amount);

    return {
      transactionType: 'Payment',
      account: holderAddress,
      destination: this.issuerAddress,
      amount: { currency: this.currency, issuer: this.issuerAddress, value: amount },
      memo: memo || this._defaultMemo('burn', amount),
      newCirculatingSupply: this.circulatingSupply,
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Step 5 — Freeze controls
  // ---------------------------------------------------------------------------

  /**
   * Individual freeze: issuer freezes a specific trust line (TrustSet tfSetFreeze).
   */
  freezeTrustLine(holderAddress) {
    this._getTrustLine(holderAddress).freeze();
    return { transactionType: 'TrustSet', flags: 'tfSetFreeze', account: this.issuerAddress, holder: holderAddress };
  }

  unfreezeTrustLine(holderAddress) {
    this._getTrustLine(holderAddress).unfreeze();
    return { transactionType: 'TrustSet', flags: 'tfClearFreeze', account: this.issuerAddress, holder: holderAddress };
  }

  /**
   * Global freeze: halts all CIPR payments on the issuance (AccountSet asfGlobalFreeze).
   */
  setGlobalFreeze() {
    this.globalFreeze = true;
    return { transactionType: 'AccountSet', setFlag: 7, account: this.issuerAddress, globalFreeze: true };
  }

  clearGlobalFreeze() {
    this.globalFreeze = false;
    return { transactionType: 'AccountSet', clearFlag: 7, account: this.issuerAddress, globalFreeze: false };
  }

  // ---------------------------------------------------------------------------
  // Reserve & supply status
  // ---------------------------------------------------------------------------

  reserveStatus() {
    const totalReserved = this.reserveLedger.reduce(
      (sum, entry) => sum + parseFloat(entry.amount), 0
    );
    return {
      currency: this.currency,
      issuer: this.issuerAddress,
      circulatingSupply: this.circulatingSupply,
      totalReserved: String(totalReserved),
      reserveRatio: parseFloat(this.circulatingSupply) > 0
        ? (totalReserved / parseFloat(this.circulatingSupply)).toFixed(4)
        : 'N/A',
      reserveEntries: this.reserveLedger.length,
      globalFreeze: this.globalFreeze,
    };
  }

  getTrustLine(holderAddress) {
    return this.trustLines[holderAddress] || null;
  }

  allTrustLines() {
    return Object.values(this.trustLines).map((tl) => tl.toJSON());
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _initHotWalletTrustLine() {
    const tl = new TrustLine(this.currency, this.issuerAddress, this.hotWalletAddress, this.maxSupply);
    this.trustLines[this.hotWalletAddress] = tl;
  }

  _getTrustLine(address) {
    const tl = this.trustLines[address];
    if (!tl) {
      throw new Error(
        `No trust line found for ${address}. ` +
        `Account must call TrustSet before receiving ${this.currency}.`
      );
    }
    return tl;
  }

  _assertNotGloballyFrozen() {
    if (this.globalFreeze) {
      throw new Error('Global freeze is active — all CIPR payments are halted');
    }
  }

  /**
   * Retire the oldest reserve entry/entries totalling the burned amount.
   */
  _retireReserve(amount) {
    let remaining = parseFloat(amount);
    while (remaining > 0 && this.reserveLedger.length > 0) {
      const entry = this.reserveLedger[0];
      const entryAmt = parseFloat(entry.amount);
      if (entryAmt <= remaining) {
        this.reserveLedger.shift();
        remaining -= entryAmt;
      } else {
        entry.amount = String(entryAmt - remaining);
        remaining = 0;
      }
    }
  }

  /**
   * Build a default UCC-anchored memo for a transaction.
   */
  _defaultMemo(action, amount) {
    const anchors = {
      mint:     '12 USC 411 — issued against documented reserve; UCC 3-603 tender established',
      transfer: 'UCC 3-311 accord & satisfaction; UCC 3-603 good-faith tender',
      burn:     'Reserve offset recorded; obligation discharged under UCC 3-311/3-603',
    };
    return `CIPR ${action.toUpperCase()} ${amount} | ${anchors[action] || ''}`;
  }
}

module.exports = CIPRIssuance;
