/**
 * Block — the fundamental unit of finalized value on the CipherNex ledger.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCEPTUAL FOUNDATION — Settlement vs. Debt
 * ─────────────────────────────────────────────────────────────────────────────
 * In a debt-based monetary system (e.g., Federal Reserve Notes), every unit of
 * currency in circulation represents a deferred obligation — an IOU that can
 * never be truly settled because the instrument used to "repay" is itself
 * another promissory note issued by the same system.  The ledger is perpetually
 * unbalanced: no new value enters, liabilities are merely reassigned.
 *
 * CipherNex operates on the opposite principle: each Block is a SETTLEMENT
 * record, not a promise.  Once a block is mined and appended to the chain:
 *
 *   • The transactions inside it are FINAL — they represent value that has
 *     already moved between parties, not a future obligation.
 *   • The Proof-of-Work (PoW) hash seals the record cryptographically; it
 *     cannot be altered without invalidating every subsequent block.
 *   • The previousHash field creates an unbroken chain of accountability —
 *     each settlement references the one before it, tracing value back to
 *     the genesis reserve.
 *
 * This mirrors the XRP Ledger settlement model: every transaction achieves
 * FINALITY of value, not a deferred promise.  The ledger stays balanced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STRUCTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *   timestamp     — exact moment this block was proposed for settlement
 *   transactions  — array of Transaction objects being permanently recorded
 *   previousHash  — cryptographic link to the prior settled block
 *   nonce         — PoW work counter; proves computational effort was expended
 *   metadata      — chain identity (chainId, networkName, currencySymbol)
 *   hash          — SHA-256 fingerprint of all fields above; unique per block
 *
 * The hash is recomputed on every nonce increment during mining.  When the
 * leading characters of the hash match the required difficulty target, the
 * block is considered "mined" and its value is permanently settled.
 */

const crypto = require('crypto');
const Transaction = require('./Transaction');

class Block {
  /**
   * Construct a new block.
   *
   * @param {number|string} timestamp    - Block creation time (Unix ms or ISO string)
   * @param {Array}         transactions - Validated Transaction objects to settle
   * @param {string}        previousHash - Hash of the prior block in the chain
   * @param {object}        metadata     - Network identity fields
   */
  constructor(timestamp = Date.now(), transactions = [], previousHash = '', metadata = {}) {
    this.timestamp    = timestamp;
    this.transactions = transactions;   // Step A — assemble pending settled items
    this.previousHash = previousHash;   // Step B — link to prior settlement record
    this.nonce        = 0;             // Step C — work counter starts at zero
    this.metadata     = metadata;      // Step D — network identity stamp
    this.hash         = this.computeHash(); // Step E — initial hash before mining
  }

  /**
   * Compute the SHA-256 fingerprint of this block's content.
   *
   * Every field is included in the hash input — any single-bit change in any
   * transaction or field will produce a completely different hash, making
   * tampering immediately detectable during chain validation.
   *
   * This is the cryptographic guarantee of settlement finality: once a hash
   * is accepted by the network, the record is immutable.
   *
   * @returns {string} 64-character hex SHA-256 digest
   */
  computeHash() {
    return crypto
      .createHash('sha256')
      .update(
        this.previousHash +
        this.timestamp +
        JSON.stringify(this.transactions) +
        JSON.stringify(this.metadata) +
        this.nonce
      )
      .digest('hex');
  }

  /**
   * Mine this block using Proof-of-Work.
   *
   * Mining is the consensus mechanism that confirms a block's transactions
   * as settled.  The miner must find a nonce value such that the resulting
   * SHA-256 hash begins with `difficulty` leading zeros.
   *
   * Step-by-step:
   *   1. Set target = '0'.repeat(difficulty)          — e.g., '00' at difficulty 2
   *   2. Increment nonce by 1
   *   3. Recompute hash with new nonce
   *   4. Repeat until hash.startsWith(target) is true
   *   5. Block is now "sealed" — all its transactions are settled
   *
   * The computational effort (expended energy/time) is a form of real-world
   * proof: work was performed.  This stands in contrast to debt systems where
   * obligations are created by bookkeeping entry alone, with no corresponding
   * substance.
   *
   * @param {number} difficulty - Number of leading zeros required in the hash
   */
  mine(difficulty) {
    const target = '0'.repeat(difficulty);
    // Keep incrementing nonce until the hash meets the difficulty target
    while (this.hash.substring(0, difficulty) !== target) {
      this.nonce += 1;
      this.hash = this.computeHash();
    }
    // At this point: hash is valid, block is sealed, transactions are final.
  }

  /**
   * Reconstruct a Block from its JSON representation (e.g., loaded from storage).
   *
   * Transactions are rebuilt as full Transaction class instances so that
   * signature verification (isValid()) remains callable on restored blocks.
   * The stored hash and nonce are preserved exactly — no re-mining needed.
   *
   * @param {object} data - Plain JSON block object from storage
   * @returns {Block}
   */
  static fromJSON(data) {
    const transactions = data.transactions.map((tx) => Transaction.fromJSON(tx));
    const block = new Block(data.timestamp, transactions, data.previousHash, data.metadata || {});
    // Restore the exact sealed state — do not recompute hash or nonce
    block.nonce = data.nonce;
    block.hash  = data.hash;
    return block;
  }
}

module.exports = Block;
