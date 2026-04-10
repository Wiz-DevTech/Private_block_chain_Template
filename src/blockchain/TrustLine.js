/**
 * TrustLine — models an XRPL-style trust line between a holder and an issuer
 * for a specific currency (e.g. CIPR).
 *
 * On XRPL, a trust line must be established by the holder before the issuer
 * can send (mint) tokens to that account. The limit is a ceiling the holder
 * self-imposes; the issuer can freeze any individual trust line independently
 * of the global freeze flag.
 */
class TrustLine {
  /**
   * @param {string} currency   - Token ticker, e.g. "CIPR"
   * @param {string} issuer     - Issuing (cold) wallet address
   * @param {string} holder     - Account that established the trust line
   * @param {string} limit      - Maximum balance the holder will accept (string to avoid float drift)
   */
  constructor(currency, issuer, holder, limit = '1000000000') {
    this.currency = currency;
    this.issuer = issuer;
    this.holder = holder;
    this.limit = limit;
    this.balance = '0';
    this.frozen = false;           // individual freeze set by issuer
    this.authorised = true;        // false if issuer uses requireAuth flag
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * Credit tokens to this trust line (called on a Payment from issuer → holder).
   * Throws if frozen or over limit.
   */
  credit(amount) {
    this._assertNotFrozen();
    const newBalance = this._toNum(this.balance) + this._toNum(amount);
    if (newBalance > this._toNum(this.limit)) {
      throw new Error(
        `Credit of ${amount} exceeds trust line limit of ${this.limit} for ${this.holder}`
      );
    }
    this.balance = String(newBalance);
    this.updatedAt = Date.now();
  }

  /**
   * Debit tokens from this trust line (transfer out or burn back to issuer).
   * Throws if frozen or insufficient balance.
   */
  debit(amount) {
    this._assertNotFrozen();
    const newBalance = this._toNum(this.balance) - this._toNum(amount);
    if (newBalance < 0) {
      throw new Error(
        `Insufficient trust line balance for ${this.holder}: has ${this.balance}, needs ${amount}`
      );
    }
    this.balance = String(newBalance);
    this.updatedAt = Date.now();
  }

  /**
   * Issuer sets freeze flag on this individual trust line.
   * While frozen, no payments can flow through it in either direction.
   */
  freeze() {
    this.frozen = true;
    this.updatedAt = Date.now();
  }

  unfreeze() {
    this.frozen = false;
    this.updatedAt = Date.now();
  }

  toJSON() {
    return {
      currency: this.currency,
      issuer: this.issuer,
      holder: this.holder,
      limit: this.limit,
      balance: this.balance,
      frozen: this.frozen,
      authorised: this.authorised,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  _assertNotFrozen() {
    if (this.frozen) {
      throw new Error(`Trust line for ${this.holder} is frozen`);
    }
  }

  _toNum(value) {
    const n = parseFloat(value);
    if (Number.isNaN(n)) throw new Error(`Invalid numeric value: ${value}`);
    return n;
  }
}

module.exports = TrustLine;
