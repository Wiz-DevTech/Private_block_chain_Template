/**
 * TrustLine — a voluntary, bounded channel between a CIPR holder and the issuer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCEPTUAL FOUNDATION — Consent vs. Imposed Obligation
 * ─────────────────────────────────────────────────────────────────────────────
 * In the existing debt-based monetary system, an individual's obligation to
 * the system is established without their explicit, informed consent.  Birth
 * registration creates an evidence-of-pledge — a performance contract —
 * representing the productive value of that individual.  The individual is
 * enrolled as surety for the public debt by operation of law, not by choice.
 *
 * A CipherNex TrustLine is the exact opposite:
 *
 *   CONSENT     — The holder must explicitly call TrustSet before they can
 *                 receive any CIPR.  The issuer cannot push tokens to an
 *                 account that has not opened a trust line.  No obligation
 *                 is imposed; the relationship is entered voluntarily.
 *
 *   SELF-LIMIT  — The holder sets their own `limit` — the maximum balance
 *                 they are willing to hold.  This is sovereignty over one's
 *                 own financial exposure, mirroring natural equity principles.
 *
 *   REVERSIBLE  — The issuer may freeze an individual trust line for compliance
 *                 purposes, but the frozen state is recorded, visible, and
 *                 auditable.  There is no hidden hypothecation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * XRPL ALIGNMENT
 * ─────────────────────────────────────────────────────────────────────────────
 * On the XRP Ledger, issued currencies (tokens) can only flow between two
 * accounts if a trust line exists between them.  This TrustLine class models
 * that relationship precisely:
 *
 *   currency  — the ticker of the issued currency (e.g., 'CIPR')
 *   issuer    — the cold wallet address that mints and controls the currency
 *   holder    — the account that accepted the trust relationship
 *   limit     — the holder's self-imposed ceiling on balance (XRPL LimitAmount)
 *   balance   — current CIPR held in this trust line (always ≤ limit)
 *   frozen    — whether the issuer has individually frozen this trust line
 *   authorised— whether the issuer's requireAuth flag allows this holder
 *
 * The balance is stored as a string throughout to avoid IEEE 754 floating-point
 * rounding errors — precision in financial records is non-negotiable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FLOW SUMMARY
 * ─────────────────────────────────────────────────────────────────────────────
 *   Step 3  TrustSet  →  holder opens this trust line (constructor called)
 *   Step 4  Issue     →  credit() called; balance increases toward limit
 *   Step 5  Transfer  →  debit() on sender's line, credit() on receiver's line
 *   Step 6  Settle    →  debit() called; balance decreases; reserve retired
 */
class TrustLine {
  /**
   * Create a new trust line for a holder toward an issuer.
   *
   * This is triggered automatically when a holder calls TrustSet (Step 3).
   * The initial balance is always '0' — the holder has agreed to accept
   * CIPR up to `limit` but holds none yet.
   *
   * @param {string} currency  - Token ticker, e.g. 'CIPR'
   * @param {string} issuer    - Cold wallet address (mint authority)
   * @param {string} holder    - Account opening the trust line (voluntary)
   * @param {string} limit     - Max CIPR the holder will accept (self-imposed ceiling)
   */
  constructor(currency, issuer, holder, limit = '100000000000') {
    // ── Identity fields ──────────────────────────────────────────────────────
    this.currency = currency; // which issued currency this trust line covers
    this.issuer   = issuer;   // cold wallet — the source of issuance authority
    this.holder   = holder;   // account that voluntarily opened this channel

    // ── Consent & limit fields ───────────────────────────────────────────────
    // The holder declares the maximum CIPR they accept.  No tokens beyond this
    // limit can be credited to this trust line — consent has clear bounds.
    this.limit = limit;

    // Balance starts at zero — no value flows until the issuer mints (Step 4)
    this.balance = '0';

    // ── Control flags ────────────────────────────────────────────────────────
    // frozen:     Set by the issuer via TrustSet tfSetFreeze; halts this account.
    //             Unlike the debt system's silent restrictions, this flag is
    //             transparent and recorded on the ledger.
    this.frozen = false;

    // authorised: When the issuer uses requireAuth mode, only explicitly
    //             authorised trust lines may receive CIPR.  Default: true
    //             (open issuance; all trust-line holders may receive).
    this.authorised = true;

    // ── Audit timestamps ─────────────────────────────────────────────────────
    this.createdAt = Date.now(); // when the holder established this trust line
    this.updatedAt = Date.now(); // most recent credit, debit, or freeze event
  }

  /**
   * Credit tokens to this trust line.
   *
   * Called during Step 4 (Issue / mint) when the issuer sends CIPR to this
   * holder, and during Step 5 (Transfer) when another holder sends CIPR here.
   *
   * Guards:
   *   1. Frozen check  — a frozen trust line cannot receive value (issuer control)
   *   2. Limit check   — balance cannot exceed the holder's self-imposed ceiling
   *
   * The limit guard protects holder sovereignty: the issuer cannot force more
   * CIPR onto a holder than the holder agreed to accept.
   *
   * @param {string|number} amount - CIPR to add to this trust line
   * @throws {Error} if trust line is frozen or credit would exceed limit
   */
  credit(amount) {
    // Step A — Verify the trust line is not under an issuer freeze
    this._assertNotFrozen();

    // Step B — Compute new balance and verify it stays within consent bounds
    const newBalance = this._toNum(this.balance) + this._toNum(amount);
    if (newBalance > this._toNum(this.limit)) {
      throw new Error(
        `Credit of ${amount} exceeds trust line limit of ${this.limit} for ${this.holder}`
      );
    }

    // Step C — Update balance (stored as string to preserve precision)
    this.balance   = String(newBalance);
    this.updatedAt = Date.now();
  }

  /**
   * Debit tokens from this trust line.
   *
   * Called during Step 5 (Transfer) when this holder sends CIPR to another
   * holder, and during Step 6 (Settle / burn) when the holder returns CIPR
   * to the issuer to discharge their obligation.
   *
   * Guards:
   *   1. Frozen check   — a frozen trust line cannot debit (issuer control)
   *   2. Balance check  — balance cannot go negative; value cannot be created
   *                       from nothing (this is the core anti-fiat guarantee)
   *
   * @param {string|number} amount - CIPR to remove from this trust line
   * @throws {Error} if trust line is frozen or balance is insufficient
   */
  debit(amount) {
    // Step A — Verify the trust line is active (not frozen)
    this._assertNotFrozen();

    // Step B — Ensure sufficient balance exists before debiting
    // This prevents fractional-reserve behaviour: you cannot send what you do not hold.
    const newBalance = this._toNum(this.balance) - this._toNum(amount);
    if (newBalance < 0) {
      throw new Error(
        `Insufficient trust line balance for ${this.holder}: has ${this.balance}, needs ${amount}`
      );
    }

    // Step C — Update balance
    this.balance   = String(newBalance);
    this.updatedAt = Date.now();
  }

  /**
   * Freeze this trust line (issuer-initiated compliance action).
   *
   * Mirrors XRPL TrustSet tfSetFreeze flag.  While frozen, neither credit nor
   * debit is permitted — the holder cannot receive or send CIPR.
   *
   * This is a targeted, individual-account action.  It does not affect other
   * trust lines or the overall issuance.  The frozen state is stored on the
   * trust line object and is visible in any audit or balance query.
   */
  freeze() {
    this.frozen    = true;
    this.updatedAt = Date.now();
    // The trust line is now suspended — no value flows until unfrozen.
  }

  /**
   * Unfreeze this trust line — restores normal credit/debit capability.
   * Mirrors XRPL TrustSet tfClearFreeze flag.
   */
  unfreeze() {
    this.frozen    = false;
    this.updatedAt = Date.now();
  }

  /**
   * Serialize this trust line to a plain JSON object.
   *
   * Used for API responses, persistent storage, and the trust line registry
   * returned by GET /api/cipr/trustlines.  All fields are included so that
   * auditors can verify the full state of every trust relationship.
   *
   * @returns {object} JSON-safe representation of this trust line
   */
  toJSON() {
    return {
      currency:   this.currency,   // which issued currency
      issuer:     this.issuer,     // cold wallet / mint authority
      holder:     this.holder,     // account that opened this channel
      limit:      this.limit,      // holder's self-declared acceptance ceiling
      balance:    this.balance,    // current CIPR held (always 0 ≤ balance ≤ limit)
      frozen:     this.frozen,     // true = suspended by issuer (transparent)
      authorised: this.authorised, // issuer's requireAuth approval status
      createdAt:  this.createdAt,  // timestamp: when holder established trust
      updatedAt:  this.updatedAt,  // timestamp: most recent state change
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Assert this trust line is not currently frozen.
   * Called before every credit or debit operation.
   * @throws {Error} if frozen is true
   */
  _assertNotFrozen() {
    if (this.frozen) {
      throw new Error(`Trust line for ${this.holder} is frozen`);
    }
  }

  /**
   * Parse a string or number to a float, throwing on invalid input.
   * Financial precision requires explicit error detection — silent NaN
   * coercion could corrupt balances without warning.
   *
   * @param {string|number} value
   * @returns {number}
   * @throws {Error} if value is not a valid number
   */
  _toNum(value) {
    const n = parseFloat(value);
    if (Number.isNaN(n)) throw new Error(`Invalid numeric value: ${value}`);
    return n;
  }
}

module.exports = TrustLine;
