const EC = require('elliptic').ec;
const crypto = require('crypto');

const ec = new EC('secp256k1');

/**
 * Transaction — extended with XRPL-aligned structure for CIPR.
 *
 * transactionType mirrors XRPL types:
 *   'Payment'    — standard value transfer (native or issued currency)
 *   'TrustSet'   — establish / modify a trust line
 *   'AccountSet' — configure account flags (DefaultRipple, GlobalFreeze, etc.)
 *
 * For Payment transactions involving issued currency (CIPR), `amount` is an
 * object: { currency, issuer, value } — matching XRPL's Amount field schema.
 * For native-coin payments `amount` remains a plain number.
 *
 * UCC legal memo fields:
 *   memo        — free-text or UCC anchor string
 *   uccTender   — '3-311' | '3-603' | null  (accord/satisfaction or tender)
 *
 * flags — XRPL-style numeric flags (e.g. 1048576 = tfSetFreeze).
 */
class Transaction {
  constructor(fromAddress, toAddress, amount, memo = '', options = {}) {
    this.transactionType = options.transactionType || 'Payment';
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;

    // amount may be a plain number (native coin) or an XRPL Amount object
    // { currency: 'CIPR', issuer: '<address>', value: '<string>' }
    this.amount = amount;

    this.memo = memo;

    // UCC legal anchor: '3-311' (accord & satisfaction) | '3-603' (tender of payment) | null
    this.uccTender = options.uccTender || null;

    // XRPL-style flags field (e.g. tfSetFreeze = 1048576)
    this.flags = options.flags || 0;

    // For TrustSet: the LimitAmount object { currency, issuer, value }
    this.limitAmount = options.limitAmount || null;

    // For AccountSet: flag codes to set/clear
    this.setFlag   = options.setFlag   || null;
    this.clearFlag = options.clearFlag || null;

    this.timestamp = Date.now();
    this.signature = null;
  }

  calculateHash() {
    const amountStr = typeof this.amount === 'object'
      ? JSON.stringify(this.amount)
      : String(this.amount);

    return crypto
      .createHash('sha256')
      .update(
        this.transactionType +
        (this.fromAddress || '') +
        (this.toAddress   || '') +
        amountStr +
        this.timestamp +
        this.memo +
        (this.uccTender || '') +
        this.flags
      )
      .digest('hex');
  }

  signTransaction(signingKey) {
    if (signingKey.getPublic('hex') !== this.fromAddress) {
      throw new Error('Cannot sign transaction for other wallet');
    }
    const hashTx = this.calculateHash();
    const sign = signingKey.sign(hashTx, 'base64');
    this.signature = sign.toDER('hex');
  }

  isValid() {
    // Coinbase / system transactions (fromAddress null) are always valid
    if (this.fromAddress === null) return true;

    if (!this.signature || this.signature.length === 0) {
      throw new Error('No signature in this transaction');
    }

    const publicKey = ec.keyFromPublic(this.fromAddress, 'hex');
    return publicKey.verify(this.calculateHash(), this.signature);
  }

  /**
   * Resolve the numeric value of this transaction for balance calculations.
   * Returns 0 for non-Payment types (TrustSet, AccountSet carry no balance).
   */
  numericAmount() {
    if (this.transactionType !== 'Payment') return 0;
    if (typeof this.amount === 'object' && this.amount !== null) {
      return parseFloat(this.amount.value || 0);
    }
    return parseFloat(this.amount) || 0;
  }

  /**
   * Returns a UCC discharge evidence string suitable for record-keeping.
   * Only meaningful for Payment transactions.
   */
  dischargeEvidence() {
    if (this.transactionType !== 'Payment' || !this.uccTender) return null;
    const ucc = this.uccTender === '3-603'
      ? 'UCC 3-603 — Tender of Payment; refusal discharges obligation'
      : 'UCC 3-311 — Accord & Satisfaction; obligation satisfied in full';
    return {
      transactionHash: this.calculateHash(),
      timestamp: this.timestamp,
      from: this.fromAddress,
      to: this.toAddress,
      amount: this.amount,
      uccAnchor: ucc,
      memo: this.memo,
    };
  }

  static fromJSON(data) {
    const tx = new Transaction(
      data.fromAddress,
      data.toAddress,
      data.amount,
      data.memo || '',
      {
        transactionType: data.transactionType || 'Payment',
        uccTender:   data.uccTender   || null,
        flags:       data.flags       || 0,
        limitAmount: data.limitAmount || null,
        setFlag:     data.setFlag     || null,
        clearFlag:   data.clearFlag   || null,
      }
    );
    tx.timestamp = data.timestamp;
    tx.signature = data.signature;
    return tx;
  }
}

module.exports = Transaction;
