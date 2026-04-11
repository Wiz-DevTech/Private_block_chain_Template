/**
 * Transaction — a single unit of value movement, trust establishment, or
 * account configuration on the CipherNex / CIPR ledger.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCEPTUAL FOUNDATION — Performing on Both Ledgers
 * ─────────────────────────────────────────────────────────────────────────────
 * The existing monetary system operates on a single, circular ledger:
 *
 *   People → Taxes → Treasury → Interest → Federal Reserve → More Bonds → More Debt
 *
 * Every instrument in that cycle (Federal Reserve Notes, Treasury Bonds) is
 * itself a liability — debt discharged with more debt.  The ledger can never
 * truly balance because no substance enters the system; only obligations shift.
 *
 * CipherNex Transactions are designed to perform on TWO ledgers simultaneously:
 *
 *   PUBLIC LEDGER  — The immutable blockchain chain (transparent, auditable).
 *                    Every transaction is recorded, hash-linked, and permanent.
 *                    This mirrors the public suretyship obligation.
 *
 *   PRIVATE LEDGER — The CIPR trust line and reserve ledger (held in trust by
 *                    the issuer).  Every Payment of issued currency is backed
 *                    1:1 by a documented reserve entry.  This is the private
 *                    substance — real equity, not fiat.
 *
 * When a CIPR transaction is signed and submitted, it creates an evidence trail
 * on both ledgers simultaneously.  The UCC memo fields carry the legal anchors
 * that establish this as a good-faith tender of substantive value.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRANSACTION TYPES (mirrors XRPL)
 * ─────────────────────────────────────────────────────────────────────────────
 *   'Payment'    — Transfers value between parties.  For native coin, amount is
 *                  a plain number.  For CIPR (issued currency), amount is an
 *                  XRPL Amount object: { currency, issuer, value }.
 *                  This is the primary settlement instrument.
 *
 *   'TrustSet'   — Holder voluntarily establishes a trust line toward the issuer.
 *                  Unlike the debt system (where obligation is imposed via birth
 *                  registration and tax law), a TrustSet is CONSENT — the holder
 *                  chooses to accept CIPR up to a self-defined limit.
 *
 *   'AccountSet' — Configures issuer-level flags:
 *                    asfDefaultRipple (flag 8) — enables token flow between accounts
 *                    asfGlobalFreeze  (flag 7) — halts all payments (compliance tool)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UCC LEGAL ANCHORS
 * ─────────────────────────────────────────────────────────────────────────────
 * Every CIPR transaction carries a memo with one or more of these legal anchors:
 *
 *   12 USC 411   — Notes (currency) shall be obligations of the Federal Reserve
 *                  and shall be redeemable ... in lawful money.  CIPR inverts
 *                  this: it is issued against assets held in trust, not as a
 *                  liability.  The reserve entry IS the lawful backing.
 *
 *   UCC 3-311    — Accord & Satisfaction.  When a CIPR payment is tendered and
 *                  accepted, the underlying obligation is satisfied in full.
 *                  This is a true zeroing of the ledger — substance for substance.
 *
 *   UCC 3-603    — Tender of Payment.  Good-faith presentment of CIPR discharges
 *                  the obligation.  If the tender is refused, the obligation is
 *                  discharged anyway.  This ensures the instrument performs as a
 *                  superior form of consideration.
 *
 * The uccTender field records which specific UCC section governs the transaction:
 *   '3-311' — accord & satisfaction (full satisfaction of a claim)
 *   '3-603' — tender of payment (obligation discharged upon presentment)
 */

const EC = require('elliptic').ec;
const crypto = require('crypto');

// secp256k1 — the same elliptic curve used by Bitcoin and Ethereum.
// Private keys sign; public keys (addresses) verify.  The signer cannot
// forge another party's signature, ensuring chain-of-custody is provable.
const ec = new EC('secp256k1');

class Transaction {
  /**
   * Construct a new transaction.
   *
   * For CIPR Payment transactions, amount should be an XRPL Amount object:
   *   { currency: 'CIPR', issuer: '<cold-wallet-address>', value: '<string>' }
   *
   * For native-coin payments (PoW mining rewards, genesis allocations):
   *   amount is a plain number.
   *
   * @param {string|null}   fromAddress  - Sender public key (null for coinbase/system txs)
   * @param {string}        toAddress    - Recipient public key
   * @param {number|object} amount       - Value being transferred
   * @param {string}        [memo]       - UCC anchor string or free-text note
   * @param {object}        [options]    - Extended XRPL-aligned fields
   * @param {string}        [options.transactionType]  - 'Payment' | 'TrustSet' | 'AccountSet'
   * @param {string}        [options.uccTender]        - '3-311' | '3-603' | null
   * @param {number}        [options.flags]            - XRPL-style flags bitmask
   * @param {object}        [options.limitAmount]      - TrustSet limit: { currency, issuer, value }
   * @param {number}        [options.setFlag]          - AccountSet flag to activate
   * @param {number}        [options.clearFlag]        - AccountSet flag to deactivate
   */
  constructor(fromAddress, toAddress, amount, memo = '', options = {}) {
    // ── XRPL-aligned type field ──────────────────────────────────────────────
    // Defaults to 'Payment' — the primary instrument of value settlement.
    this.transactionType = options.transactionType || 'Payment';

    // ── Parties ──────────────────────────────────────────────────────────────
    // fromAddress is the sender's secp256k1 public key (hex).
    // null is reserved for coinbase (mining reward) and genesis allocations —
    // system-issued credits that require no sender signature.
    this.fromAddress = fromAddress;
    this.toAddress   = toAddress;

    // ── Amount ───────────────────────────────────────────────────────────────
    // Plain number  → native CIPR coin (used for mining rewards, genesis)
    // Object        → issued currency: { currency: 'CIPR', issuer, value }
    //                 This is XRPL's issued-currency Amount schema, ensuring
    //                 the instrument carries full asset-lineage information.
    this.amount = amount;

    // ── Legal memo ───────────────────────────────────────────────────────────
    // The memo is the bridge between the public blockchain record and the
    // private trust/reserve ledger.  It carries the UCC anchor that establishes
    // the legal standing of the payment as a good-faith tender.
    this.memo = memo;

    // ── UCC Tender anchor ────────────────────────────────────────────────────
    // '3-311' — the payment satisfies an existing claim (accord & satisfaction)
    // '3-603' — the payment is tendered in good faith; refusal discharges duty
    // null    — no UCC claim attached (e.g., internal transfers, non-commercial)
    this.uccTender = options.uccTender || null;

    // ── XRPL flags ───────────────────────────────────────────────────────────
    // Numeric bitmask of XRPL transaction flags.
    //   TrustSet flags: tfSetFreeze (1048576), tfClearFreeze (2097152)
    //   Payment flags:  tfNoRippleDirect, tfPartialPayment, etc.
    this.flags = options.flags || 0;

    // ── TrustSet fields ──────────────────────────────────────────────────────
    // limitAmount: the holder's self-imposed ceiling for issued-currency trust.
    // This field is only populated for TrustSet transactions.
    this.limitAmount = options.limitAmount || null;

    // ── AccountSet fields ────────────────────────────────────────────────────
    // setFlag / clearFlag: numeric codes that configure the issuer's account.
    //   7 = asfGlobalFreeze   — halts all payments on the issuance
    //   8 = asfDefaultRipple  — enables rippling (token flow) between accounts
    this.setFlag   = options.setFlag   || null;
    this.clearFlag = options.clearFlag || null;

    // ── Timestamp & signature ────────────────────────────────────────────────
    this.timestamp = Date.now(); // Unix milliseconds — recorded for audit trail
    this.signature = null;       // Populated by signTransaction(); null until signed
  }

  /**
   * Compute a SHA-256 hash of all fields that define this transaction's identity.
   *
   * This hash is what the sender signs and what verifiers check.  Every field
   * that affects the meaning of the transaction is included, ensuring that a
   * signature on hash H proves the sender approved this exact transaction —
   * not a modified version.
   *
   * @returns {string} 64-character hex SHA-256 digest
   */
  calculateHash() {
    // Issued-currency amount must be serialised consistently for hash stability
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

  /**
   * Sign this transaction with the sender's private key.
   *
   * Step 1 — Verify: the signing key's public key must match fromAddress.
   *           This prevents one party from signing on behalf of another.
   * Step 2 — Hash: compute the transaction's unique fingerprint.
   * Step 3 — Sign: produce a DER-encoded ECDSA signature over the hash.
   *
   * The resulting signature is stored in this.signature.  It is the
   * cryptographic proof that the owner of fromAddress authorised this
   * specific payment, trust-set, or account configuration — no more,
   * no less.  This is the digital equivalent of a wet ink signature
   * on a negotiable instrument.
   *
   * @param {EC.KeyPair} signingKey - elliptic KeyPair generated from the sender's private key
   */
  signTransaction(signingKey) {
    // Guard: signer must be the declared sender
    if (signingKey.getPublic('hex') !== this.fromAddress) {
      throw new Error('Cannot sign transaction for other wallet');
    }
    const hashTx  = this.calculateHash();
    const sign    = signingKey.sign(hashTx, 'base64');
    this.signature = sign.toDER('hex'); // DER hex — compact, standard encoding
  }

  /**
   * Verify this transaction's signature against the sender's public key.
   *
   * Step 1 — Coinbase check: system-issued transactions (fromAddress === null)
   *           have no sender and require no signature; they are always valid.
   *           These represent genesis allocations and mining rewards — value
   *           created by the network itself, not transferred between parties.
   *
   * Step 2 — Signature presence check: a transaction without a signature has
   *           not been authorised; it must not be added to the chain.
   *
   * Step 3 — Cryptographic verification: reconstruct the hash and verify the
   *           stored DER signature using the sender's public key.  If valid,
   *           it is mathematically certain that the owner of fromAddress signed
   *           this exact transaction.
   *
   * @returns {boolean} true if the signature is valid (or if it is a coinbase tx)
   * @throws  {Error}   if the signature field is missing
   */
  isValid() {
    // Step 1 — Coinbase / genesis: no signature required
    if (this.fromAddress === null) return true;

    // Step 2 — Signature must be present
    if (!this.signature || this.signature.length === 0) {
      throw new Error('No signature in this transaction');
    }

    // Step 3 — Cryptographic verification
    const publicKey = ec.keyFromPublic(this.fromAddress, 'hex');
    return publicKey.verify(this.calculateHash(), this.signature);
  }

  /**
   * Resolve the numeric value of this transaction for balance calculations.
   *
   * Only Payment transactions carry a balance-relevant amount.
   * TrustSet and AccountSet are structural instructions — they configure the
   * channel through which value flows, but do not themselves move value.
   *
   * For issued-currency Payments (CIPR), the value is extracted from the
   * nested Amount object's `value` string field.
   *
   * @returns {number} numeric amount, or 0 for non-Payment types
   */
  numericAmount() {
    if (this.transactionType !== 'Payment') return 0;
    if (typeof this.amount === 'object' && this.amount !== null) {
      return parseFloat(this.amount.value || 0);
    }
    return parseFloat(this.amount) || 0;
  }

  /**
   * Build a UCC discharge evidence record for this transaction.
   *
   * This record documents the legal standing of the payment:
   *   — Which UCC section governs the tender (3-311 or 3-603)
   *   — The exact hash, timestamp, parties, and amount involved
   *   — The memo text that was included in the original submission
   *
   * Purpose: when a CIPR payment is tendered against a public obligation,
   * this evidence record can be presented as proof that the holder of the
   * private bond performed on both ledgers — satisfying the obligation in
   * substance, not merely shifting the debt to another instrument.
   *
   * Returns null for non-Payment transactions or those without a UCC anchor.
   *
   * @returns {object|null} discharge evidence record, or null if not applicable
   */
  dischargeEvidence() {
    if (this.transactionType !== 'Payment' || !this.uccTender) return null;

    // Map the UCC code to its full statutory description
    const ucc = this.uccTender === '3-603'
      ? 'UCC 3-603 — Tender of Payment; refusal discharges obligation'
      : 'UCC 3-311 — Accord & Satisfaction; obligation satisfied in full';

    return {
      transactionHash: this.calculateHash(), // immutable fingerprint of this tender
      timestamp:       this.timestamp,       // exact moment of presentment
      from:            this.fromAddress,     // tendering party (bond holder)
      to:              this.toAddress,       // receiving party (obligee)
      amount:          this.amount,          // substance tendered (CIPR or native)
      uccAnchor:       ucc,                  // legal basis for discharge
      memo:            this.memo,            // additional context / reserve reference
    };
  }

  /**
   * Reconstruct a Transaction from its JSON representation.
   *
   * Used by Block.fromJSON() to restore fully functional Transaction instances
   * from persisted chain data, preserving the ability to call isValid() on
   * historical transactions for chain integrity verification.
   *
   * @param {object} data - Plain JSON transaction object
   * @returns {Transaction}
   */
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
    // Restore the original timestamp and signature — do not re-sign
    tx.timestamp = data.timestamp;
    tx.signature = data.signature;
    return tx;
  }
}

module.exports = Transaction;
