/**
 * Blockchain — the immutable, append-only public settlement ledger.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCEPTUAL FOUNDATION — An Unbalanced vs. a Balanced Ledger
 * ─────────────────────────────────────────────────────────────────────────────
 * The existing monetary system operates on what can be described as a
 * permanently unbalanced ledger:
 *
 *   Federal Reserve Notes (FRNs) are liabilities of the Federal Reserve — not
 *   assets.  When FRNs return to the Fed, the accounting cancels one liability
 *   against another.  No new value enters the system; the ledger remains
 *   unbalanced.  Payback is illusory — the same instrument that created the
 *   debt is used to discharge it.
 *
 * The CipherNex Blockchain is a balanced ledger by design:
 *
 *   IMMUTABLE RECORD   — Once a block is mined and appended, its transactions
 *                        cannot be altered.  The SHA-256 hash chain ensures
 *                        that any tampering is immediately detectable.
 *
 *   CHAIN OF CUSTODY   — Every block references the hash of the previous block.
 *                        Value can be traced from its genesis reserve entry,
 *                        through every transfer, to its final settlement (burn).
 *                        The chain of custody is complete and public.
 *
 *   PROOF OF WORK      — Each block requires computational effort to be accepted.
 *                        This mirrors the principle that substance (work/energy)
 *                        must be expended to settle a record — not just a
 *                        bookkeeping entry.
 *
 *   GENESIS ANCHOR     — The first block encodes the initial distribution of
 *                        CIPR to network accounts, tracing back to the trust
 *                        corpus.  All subsequent value flows from this anchor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUAL-LEDGER RELATIONSHIP
 * ─────────────────────────────────────────────────────────────────────────────
 * The Blockchain is the PUBLIC LEDGER — transparent, auditable, permanently
 * recorded.  It works in concert with the PRIVATE LEDGER (the CIPR trust line
 * registry and reserve ledger maintained by CIPRIssuance).
 *
 * A CIPR transaction performs on both simultaneously:
 *   — The block records the payment hash, parties, and amount (public record)
 *   — The trust line records the balance change and UCC memo (private record)
 *   — The reserve ledger confirms the backing substance exists (private record)
 *
 * This dual performance establishes CIPR as superior consideration: it satisfies
 * both the public suretyship obligation and the private substantive claim.
 */

const Block = require('./Block');
const { loadChain, saveChain, saveGenesis } = require('./Storage');

class Blockchain {
  /**
   * Construct the blockchain node's ledger state.
   *
   * Startup sequence:
   *   1. Load persisted chain from storage (/data/chain.json) if it exists.
   *   2. If no persisted chain is found, create the genesis block — the
   *      foundational settlement record encoding the initial CIPR distributions.
   *   3. Save the genesis block to storage (/data/genesis.json) for reference.
   *
   * @param {object}  config
   * @param {string}  config.chainId         - Unique network identifier
   * @param {string}  config.networkName     - Human-readable name (e.g. 'CipherNex')
   * @param {string}  config.currencySymbol  - Native coin ticker (e.g. 'CIPR')
   * @param {boolean} config.autoMining      - Auto-mine after each transaction if true
   * @param {number}  config.difficulty      - PoW target (number of leading hash zeros)
   * @param {number}  config.miningReward    - CIPR awarded to miners per block
   * @param {Array}   config.initialBalances - Genesis account allocations [{address, amount}]
   */
  constructor(config = {}) {
    // ── Network identity ─────────────────────────────────────────────────────
    this.chainId        = config.chainId       || 'ciphernex-chain-1';
    this.networkName    = config.networkName   || 'CipherNex';
    this.currencySymbol = config.currencySymbol || 'CIPR';

    // ── Mining parameters ────────────────────────────────────────────────────
    // autoMining: when true, pending transactions are mined into a block
    //             immediately upon submission (single-node convenience mode).
    this.autoMining  = config.autoMining ?? false;
    // difficulty: number of leading zeros required in a valid block hash.
    //             Higher = more work per block = stronger settlement finality.
    this.difficulty  = config.difficulty || 2;
    // miningReward: native CIPR awarded to the miner's address per settled block.
    this.miningReward = config.miningReward || 100;

    // ── Transaction pool ─────────────────────────────────────────────────────
    // Transactions waiting to be settled into the next block.
    // Visible via GET /api/transactions/pending.
    this.pendingTransactions = [];

    // ── Chain state ──────────────────────────────────────────────────────────
    // Attempt to restore the chain from persistent storage.
    // If storage is empty (first run), create the genesis block.
    const loadedChain = loadChain();
    this.chain = loadedChain || [this.createGenesisBlock(config.initialBalances)];

    // Persist the newly created chain if this is a fresh start
    if (!loadedChain) {
      saveChain(this.chain);
    }
  }

  /**
   * Create the genesis block — the foundational anchor of the ledger.
   *
   * The genesis block records the initial CIPR allocation to all network
   * accounts.  These allocations come from the trust corpus, not from thin
   * air — they are the on-chain reflection of the genesis reserve entry
   * ('GENESIS-RESERVE-001') created simultaneously in CIPRIssuance.
   *
   * Genesis transactions have fromAddress = null (coinbase / system-issued).
   * This denotes value created by the network's own authority — the genesis
   * allocations are the starting substance of the system, not obligations.
   *
   * The genesis block's previousHash is '0' — there is nothing before it.
   * This is the anchor point from which all chain-of-custody traces begin.
   *
   * @param {Array} initialBalances - [{address, amount}] genesis account credits
   * @returns {Block} the unmined genesis block (pre-hashed at construction)
   */
  createGenesisBlock(initialBalances = []) {
    // Build coinbase transactions for each genesis account
    const genesisTransactions = (initialBalances || []).map((balanceEntry) => ({
      fromAddress: null,               // null = system-issued (no sender signature required)
      toAddress:   balanceEntry.address,
      amount:      balanceEntry.amount,
      memo:        'Genesis allocation', // on-chain marker for genesis-origin credits
      timestamp:   Date.now(),
    }));

    // Construct the genesis block with network identity stamped in metadata
    const genesisBlock = new Block(
      '2026-01-01',          // genesis timestamp — the declared start of the ledger
      genesisTransactions,   // initial distributions
      '0',                   // previousHash = '0' — this IS the first record
      {
        chainId:        this.chainId,
        networkName:    this.networkName,
        currencySymbol: this.currencySymbol,
        createdAt:      '2026-01-01T00:00:00Z',
      }
    );

    // Persist the genesis block separately as a permanent reference record
    saveGenesis(genesisBlock);
    return genesisBlock;
  }

  /**
   * Return the most recently settled block (the chain tip).
   * Its hash becomes the previousHash of the next block to be mined.
   *
   * @returns {Block}
   */
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /**
   * Mine all pending transactions into a new settled block.
   *
   * Settlement sequence:
   *   1. Assemble all pending transactions into a candidate block.
   *   2. Set the block's previousHash to the current chain tip's hash,
   *      maintaining cryptographic continuity.
   *   3. Run Proof-of-Work: increment nonce until hash meets difficulty target.
   *   4. Append the newly mined block to the chain (it is now SETTLED).
   *   5. Persist the updated chain to storage.
   *   6. Issue a mining reward coinbase transaction to the miner's address
   *      (this becomes the first pending transaction for the NEXT block).
   *
   * Once step 4 is complete, all transactions in that block are FINAL.
   * They cannot be altered without invalidating the hash and every block
   * that follows — the settlement guarantee is cryptographic, not political.
   *
   * @param {string} rewardAddress - Address to receive the mining reward
   * @returns {Block} the newly mined and settled block
   */
  minePendingTransactions(rewardAddress) {
    // Step 1-3 — Assemble and mine the pending transaction block
    const block = new Block(
      Date.now(),
      this.pendingTransactions,
      this.getLatestBlock().hash // link to prior settled block
    );
    block.mine(this.difficulty); // Proof-of-Work: find a valid nonce

    // Step 4 — Append to chain (transactions are now permanently settled)
    this.chain.push(block);

    // Step 5 — Persist the updated chain
    saveChain(this.chain);

    // Step 6 — Prepare the mining reward (coinbase) for the next block
    // fromAddress = null: this is a system-issued reward, not a transfer
    this.pendingTransactions = [
      {
        fromAddress: null,
        toAddress:   rewardAddress,
        amount:      this.miningReward,
        timestamp:   Date.now(),
      },
    ];

    return block;
  }

  /**
   * Validate and queue a signed transaction for the next mining cycle.
   *
   * Validation steps:
   *   1. Both fromAddress and toAddress must be present (no anonymous transfers).
   *   2. The transaction signature must be valid — the declared sender must have
   *      signed this exact transaction hash with their private key.
   *
   * After passing validation, the transaction enters the pending pool.
   * It is NOT yet settled — it becomes final only when mined into a block.
   *
   * If autoMining is enabled (development/single-node mode), the caller is
   * expected to trigger minePendingTransactions() after submission.
   *
   * @param {Transaction} transaction - A signed Transaction instance
   * @throws {Error} if addresses are missing or the signature is invalid
   */
  addTransaction(transaction) {
    // Step 1 — Both parties must be identified
    if (!transaction.fromAddress || !transaction.toAddress) {
      throw new Error('Transaction must include from and to address');
    }

    // Step 2 — Cryptographic signature must be valid
    // This prevents anyone from submitting a transaction on behalf of another
    // account — chain-of-custody is protected at the protocol level.
    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to chain');
    }

    // Add to the pending pool — awaits mining / settlement
    this.pendingTransactions.push(transaction);
  }

  /**
   * Calculate the native CIPR balance of an address by scanning the full chain.
   *
   * This function walks every block and every transaction in the settled chain
   * (plus the current pending pool) and sums all credits and debits for the
   * given address.
   *
   * Important: this reflects the NATIVE COIN balance (PoW mining rewards,
   * genesis allocations).  CIPR issued-currency balances (trust-line model)
   * are tracked separately in CIPRIssuance.getTrustLine(address).balance.
   *
   * @param {string} address - Public key / wallet address to check
   * @returns {number} net native coin balance (can be 0 on fresh accounts)
   */
  getBalanceOfAddress(address) {
    let balance = 0;

    // Scan all settled blocks (immutable history)
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress === address) balance -= tx.amount; // outflow
        if (tx.toAddress   === address) balance += tx.amount; // inflow
      }
    }

    // Include pending transactions (not yet settled, but reserved)
    for (const pending of this.pendingTransactions) {
      if (pending.fromAddress === address) balance -= pending.amount;
      if (pending.toAddress   === address) balance += pending.amount;
    }

    return balance;
  }

  /**
   * Validate the integrity of the entire chain from block 1 onward.
   *
   * Three checks per block:
   *   1. Hash integrity  — the stored hash must equal the recomputed hash.
   *                        Any field change (even one character) produces a
   *                        completely different hash — tampering is immediately
   *                        visible.
   *
   *   2. Chain continuity — each block's previousHash must equal the prior
   *                         block's hash.  This creates an unbroken chain of
   *                         settlement records; inserting or removing a block
   *                         breaks continuity at that point.
   *
   *   3. Transaction validity — every transaction with a fromAddress must have
   *                             a valid ECDSA signature.  Unsigned or forged
   *                             transactions invalidate the chain.
   *
   * @returns {boolean} true if the chain is valid and unmodified; false otherwise
   */
  isChainValid() {
    // Start at block 1 — the genesis block (index 0) has no predecessor to check
    for (let i = 1; i < this.chain.length; i += 1) {
      const currentBlock  = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // Check 1 — Hash integrity: stored hash must match freshly computed hash
      if (currentBlock.hash !== currentBlock.computeHash()) {
        return false; // block data has been tampered with
      }

      // Check 2 — Chain continuity: this block must reference the correct prior hash
      if (currentBlock.previousHash !== previousBlock.hash) {
        return false; // chain has been broken or reordered
      }

      // Check 3 — Transaction signatures: every sender-signed transaction must verify
      for (const tx of currentBlock.transactions) {
        if (tx.fromAddress && !tx.isValid()) {
          return false; // invalid signature — possible forgery
        }
      }
    }

    return true; // chain is intact and all signatures are valid
  }
}

module.exports = Blockchain;
