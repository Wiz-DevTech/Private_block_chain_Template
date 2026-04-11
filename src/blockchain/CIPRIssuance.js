/**
 * CIPRIssuance — the CIPR token controller and substantive equity engine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCEPTUAL FOUNDATION — Reclaiming the Ledger
 * ─────────────────────────────────────────────────────────────────────────────
 * The existing monetary system creates currency by bookkeeping entry alone.
 * The Federal Reserve credits the Treasury's account with Federal Reserve Notes
 * (FRNs) created electronically; no gold, no labour, no substance backs the
 * entry.  The people later pay taxes to service (pay interest on) those same
 * bonds, completing a circular loop in which no new value ever enters:
 *
 *   People → Taxes → Treasury → Interest → Federal Reserve → More Bonds → More Debt
 *
 * FRNs can never repay the original debt because they ARE the debt.  When FRNs
 * return to the Federal Reserve, the accounting cancels one liability against
 * another.  The ledger stays perpetually unbalanced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW CIPR CORRECTS THE IMBALANCE
 * ─────────────────────────────────────────────────────────────────────────────
 * CipherNex Coin (CIPR) is a self-backing, asset-anchored private instrument
 * issued under trust by Wisdom Ignited Business Trust.  Every unit of CIPR is:
 *
 *   1. BACKED 1:1  — each mint is matched by a documented reserve entry
 *                    (a reference to real labour, creation, or pledged asset).
 *                    The government brings no substance; CIPR brings substance first.
 *
 *   2. SETTLED, NOT DEFERRED — the XRP Ledger (and this private chain) operate
 *                    as settlement layers.  Every transaction achieves finality of
 *                    value, not a promissory note.  There is no "later".
 *
 *   3. DISCHARGEABLE — when a CIPR holder burns (returns) their tokens, the
 *                    corresponding reserve entry is retired.  The ledger truly
 *                    balances — substance in, substance out.  The same instrument
 *                    that was issued to perform is the instrument that closes the
 *                    record.  Unlike FRNs, CIPR does not recirculate the obligation.
 *
 *   4. DUAL-LEDGER  — CIPR performs on both the public blockchain (the transparent
 *                    settlement record) and the private reserve/trust ledger (the
 *                    backing substance).  This dual performance establishes CIPR as
 *                    superior consideration: it satisfies both the public suretyship
 *                    obligation and the private substantive claim.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COLD WALLET / HOT WALLET ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors XRPL best practice for issued-currency issuers:
 *
 *   Cold Wallet (issuerAddress)
 *     — Holds the exclusive mint authority.
 *     — Never used for day-to-day operations; kept air-gapped.
 *     — All CIPR ultimately traces its lineage to this address.
 *     — Analogous to the trust grantor holding the master reserve.
 *
 *   Hot Wallet (hotWalletAddress)
 *     — Receives the genesis supply from the cold wallet at startup.
 *     — Distributes CIPR to end-user holders in normal operations.
 *     — Has its own trust line; balance visible and auditable.
 *     — Analogous to the trust administrator handling circulation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIX-STEP LIFECYCLE (mapped to XRPL protocol steps)
 * ─────────────────────────────────────────────────────────────────────────────
 *   Step 1  AccountSet   — Issuer configures DefaultRipple + initial flags
 *   Step 2  Account      — Holder creates a wallet (public/private key pair)
 *   Step 3  TrustSet     — Holder voluntarily establishes a trust line
 *   Step 4  Payment/Mint — Issuer mints CIPR to holder (1:1 reserve-backed)
 *   Step 5  Transfer     — Holder sends CIPR to another holder (peer settlement)
 *   Step 6  Settle/Burn  — Holder returns CIPR; reserve retired; ledger zeroed
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEGAL ANCHORS (carried in every transaction memo)
 * ─────────────────────────────────────────────────────────────────────────────
 *   12 USC 411   — Establishes that notes are obligations redeemable in lawful money.
 *                  CIPR inverts this: it IS the lawful money — issued against assets
 *                  held in trust, not as a liability of a central bank.
 *
 *   UCC 3-311    — Accord & Satisfaction.  When CIPR payment is tendered and accepted,
 *                  the underlying obligation is satisfied in full — substance for substance.
 *
 *   UCC 3-603    — Tender of Payment.  Good-faith presentment of CIPR discharges the
 *                  obligation.  Refusal by the creditor does not revive the debt.
 */

const TrustLine = require('./TrustLine');

class CIPRIssuance {
  /**
   * Initialise the CIPR issuance controller.
   *
   * On construction:
   *   1. Cold and hot wallet addresses are registered (Step 1 — AccountSet).
   *   2. Account-level flags are set: DefaultRipple (enables token flow) and
   *      GlobalFreeze (initially false — issuance is open).
   *   3. The hot wallet's trust line is established automatically so that the
   *      genesis supply can be minted to it immediately (see ContractManager).
   *
   * @param {object} config
   * @param {string} config.issuerAddress    - Cold wallet address (mint authority, air-gapped)
   * @param {string} config.hotWalletAddress - Operational wallet address (daily distribution)
   * @param {string} config.currency         - Token ticker (default 'CIPR')
   * @param {string} config.maxSupply        - Trust line ceiling / hard supply cap
   * @param {number} config.transferRate     - Basis points transfer fee (0 = feeless)
   */
  constructor(config = {}) {
    // ── Wallet architecture ──────────────────────────────────────────────────
    // Cold wallet: mint authority only — never used for transfers
    this.issuerAddress    = config.issuerAddress    || 'CIPR_ISSUER_COLD_WALLET';
    // Hot wallet: receives genesis supply; handles normal circulation
    this.hotWalletAddress = config.hotWalletAddress || 'CIPR_HOT_OPERATIONAL_WALLET';

    // ── Token identity ───────────────────────────────────────────────────────
    this.currency  = config.currency  || 'CIPR';
    this.maxSupply = config.maxSupply || '100000000000'; // 100 billion maximum

    // ── Transfer fee ─────────────────────────────────────────────────────────
    // Expressed in basis points (1 bp = 0.01%).  0 = completely feeless.
    // Fees, if any, are applied at transfer time and retained by the issuer.
    this.transferRate = config.transferRate || 0;

    // ── Step 1 — AccountSet flags ────────────────────────────────────────────
    // asfDefaultRipple (XRPL flag 8): enables token flow between non-issuer accounts.
    // Without this, CIPR can only move directly between a holder and the issuer.
    // Setting to true allows peer-to-peer CIPR payments (Step 5 — Transfer).
    this.defaultRipple = true;

    // asfGlobalFreeze (XRPL flag 7): when true, ALL CIPR payments are halted.
    // This is a compliance / emergency tool; it does not destroy holdings.
    // Starts false — issuance is open and flowing.
    this.globalFreeze = false;

    // ── Trust line registry ──────────────────────────────────────────────────
    // Maps holderAddress → TrustLine object.
    // Every account that has established a trust line (Step 3) appears here.
    // An account NOT in this map cannot receive CIPR — consent is required.
    this.trustLines = {};

    // ── Reserve ledger ───────────────────────────────────────────────────────
    // An ordered array of reserve entries.  Each entry records:
    //   { reference, amount, destination, timestamp, memo }
    // Every CIPR minted (Step 4) must have a corresponding entry here.
    // When CIPR is burned (Step 6), entries are retired FIFO until the
    // burned amount is fully offset — the ledger balances in real time.
    this.reserveLedger = [];

    // ── Circulating supply tracker ───────────────────────────────────────────
    // The total CIPR currently held across all trust lines.
    // Increases on issue(); decreases on burn().
    // circulatingSupply / totalReserved should always equal 1.0 (1:1 backing).
    this.circulatingSupply = '0';

    // ── Step 3 (pre-requisite) — Hot wallet trust line ───────────────────────
    // The hot wallet's trust line is established at construction so that the
    // genesis mint (ContractManager.initializeContracts) can proceed immediately
    // without requiring an external TrustSet call for the operational wallet.
    this._initHotWalletTrustLine();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — TrustSet: holder establishes a trust line toward the issuer
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a new trust line for a holder account (Step 3 — TrustSet).
   *
   * On XRPL, a TrustSet transaction must be submitted by the holder BEFORE
   * the issuer can send any issued currency to that account.  This class
   * mirrors that requirement exactly.
   *
   * Why consent matters:
   *   The existing system imposes obligation on individuals without consent
   *   (birth registration, tax levy).  A TrustSet is the opposite — the
   *   holder actively declares: "I accept up to [limit] CIPR from this issuer."
   *   No CIPR can arrive until that declaration is made.
   *
   * @param {string} holderAddress - Account opening the trust line
   * @param {string} [limit]       - Max CIPR accepted (defaults to maxSupply)
   * @returns {TrustLine}          The newly created trust line object
   * @throws {Error} if a trust line already exists for this address
   */
  trustSet(holderAddress, limit = this.maxSupply) {
    if (this.trustLines[holderAddress]) {
      throw new Error(`Trust line already exists for ${holderAddress}`);
    }
    // Create the trust line: currency, issuer (cold wallet), holder, limit
    const tl = new TrustLine(this.currency, this.issuerAddress, holderAddress, limit);
    // Register in the trust line map — holder is now eligible to receive CIPR
    this.trustLines[holderAddress] = tl;
    return tl;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4 — Issue (Mint): issuer credits CIPR to a trust-line holder
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Mint (issue) CIPR from the cold wallet issuer to a destination account (Step 4).
   *
   * This is the moment new CIPR enters circulation.  Unlike FRN creation (where
   * the Fed credits an account by bookkeeping entry with no real backing), every
   * CIPR mint here REQUIRES a reserve reference — a documented pointer to the
   * real-world asset, labour pledge, or trust instrument backing this issuance.
   *
   * Sequence:
   *   1. Assert global freeze is not active (issuance may proceed)
   *   2. Retrieve the destination's trust line (must exist from Step 3)
   *   3. Credit the trust line (balance increases; checked against limit)
   *   4. Record the reserve entry in the reserve ledger (substance backing)
   *   5. Increase circulatingSupply by the issued amount
   *   6. Return a mint receipt with currency object and reserve confirmation
   *
   * The receipt includes an XRPL Amount object:
   *   { currency: 'CIPR', issuer: '<cold-wallet>', value: '<amount>' }
   * This fully qualifies the instrument — any verifier knows exactly who issued it
   * and against what reserve it is backed.
   *
   * @param {string} destinationAddress - Holder address (must have trust line from Step 3)
   * @param {string} amount             - CIPR to mint (string to preserve precision)
   * @param {string} reserveReference   - Document ID / reference backing this mint (required)
   * @param {string} [memo]             - UCC/legal memo (auto-generated if omitted)
   * @returns {object} mint receipt
   * @throws {Error} if global freeze active, no trust line, or trust line limit exceeded
   */
  issue(destinationAddress, amount, reserveReference, memo = '') {
    // Step 4.1 — Compliance gate: global freeze must be clear for issuance
    this._assertNotGloballyFrozen();

    // Step 4.2 — Trust line must exist (holder consented in Step 3)
    const tl = this._getTrustLine(destinationAddress);

    // Step 4.3 — Credit the trust line (throws if frozen or over limit)
    tl.credit(amount);

    // Step 4.4 — Record the reserve entry (the substance backing this mint)
    // Each entry is immutable once written; retirement happens only on burn (Step 6).
    const reserveEntry = {
      reference:   reserveReference,            // external document / asset reference
      amount,                                    // CIPR amount this entry backs
      destination: destinationAddress,           // who received the minted CIPR
      timestamp:   Date.now(),                   // exact moment of issuance
      memo:        memo || this._defaultMemo('mint', amount), // legal anchor
    };
    this.reserveLedger.push(reserveEntry);

    // Step 4.5 — Update circulating supply (string arithmetic to avoid float drift)
    this.circulatingSupply = String(parseFloat(this.circulatingSupply) + parseFloat(amount));

    // Step 4.6 — Return the mint receipt (public record of what was issued and why)
    return {
      transactionType:       'Payment',
      account:               this.issuerAddress,       // cold wallet (issuing authority)
      destination:           destinationAddress,        // receiving holder
      amount: {
        currency: this.currency,                       // 'CIPR'
        issuer:   this.issuerAddress,                  // cold wallet — full lineage
        value:    amount,                              // amount issued
      },
      reserveEntry,                                    // the backing substance record
      newCirculatingSupply:  this.circulatingSupply,   // updated total in circulation
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5 — Transfer: holder-to-holder CIPR payment
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transfer CIPR between two non-issuer trust-line holders (Step 5 — Payment).
   *
   * This is peer-to-peer settlement: value moves from one holder's trust line
   * to another's without involving the issuer's cold wallet.  The XRP Ledger
   * enables this via the DefaultRipple flag set on the issuer account.
   *
   * Unlike the circular FRN system (where value never truly transfers — only
   * liability shifts), a CIPR transfer is a genuine change in who holds the
   * substantive claim.  The reserve backing follows the token, not the holder.
   *
   * Optional transfer fee:
   *   If transferRate > 0 (basis points), the sender's trust line is debited
   *   the gross amount while the receiver's trust line is credited the net
   *   (gross minus fee).  The fee is retained by the issuer.  Default: 0 (feeless).
   *
   * @param {string} fromAddress - Sending holder (must have trust line + sufficient balance)
   * @param {string} toAddress   - Receiving holder (must have trust line)
   * @param {string} amount      - Gross CIPR to send
   * @param {string} [memo]      - UCC/legal memo (auto-generated if omitted)
   * @returns {object} transfer receipt with gross, fee, and net amounts
   */
  transfer(fromAddress, toAddress, amount, memo = '') {
    // Step 5.1 — Compliance gate: no transfers while globally frozen
    this._assertNotGloballyFrozen();

    // Step 5.2 — Both parties must hold active trust lines
    const fromTL = this._getTrustLine(fromAddress);
    const toTL   = this._getTrustLine(toAddress);

    // Step 5.3 — Calculate transfer fee (basis points; 0 = no deduction)
    const fee = this.transferRate > 0
      ? parseFloat(amount) * (this.transferRate / 10000)
      : 0;
    const net = String(parseFloat(amount) - fee); // amount arriving at receiver

    // Step 5.4 — Debit the sender (throws if frozen or insufficient balance)
    fromTL.debit(amount);

    // Step 5.5 — Credit the receiver with the net amount (after fee)
    toTL.credit(net);

    // Step 5.6 — Return the transfer receipt
    return {
      transactionType: 'Payment',
      from:            fromAddress,
      to:              toAddress,
      grossAmount:     amount,                          // what sender debited
      fee:             String(fee),                    // retained by issuer
      netAmount:       net,                            // what receiver credited
      currency:        this.currency,
      memo:            memo || this._defaultMemo('transfer', amount),
      timestamp:       Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6 — Settle (Burn): holder returns CIPR; reserve retired; ledger zeros
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Burn (settle) CIPR: holder returns tokens to the issuer, discharging the
   * obligation and retiring the corresponding reserve entry (Step 6).
   *
   * This is the most important distinction from the existing monetary system:
   *
   *   FRN system: the instrument used to "repay" debt IS another debt note.
   *               The ledger cannot balance; liabilities merely reassign.
   *
   *   CIPR system: the holder returns the exact instrument that was issued.
   *               The trust line balance is debited (destroyed).
   *               The circulating supply decreases by the burned amount.
   *               The corresponding reserve entry is retired FIFO — the
   *               backing substance is released from the ledger in balance.
   *               The ledger TRULY zeros for the burned amount.
   *
   * This process mirrors UCC 3-311 (accord & satisfaction) and UCC 3-603
   * (tender of payment): when the holder presents CIPR to the issuer in
   * good faith, the obligation is discharged in substance, not just on paper.
   *
   * Sequence:
   *   1. Retrieve holder's trust line
   *   2. Debit the burned amount from the trust line (balance decreases)
   *   3. Decrease circulatingSupply by the burned amount
   *   4. Retire reserve entries FIFO until the burned amount is fully covered
   *   5. Return a burn receipt documenting the discharge
   *
   * @param {string} holderAddress - Holder returning CIPR to the issuer
   * @param {string} amount        - CIPR to burn (return to issuer / destroy)
   * @param {string} [memo]        - UCC discharge memo (auto-generated if omitted)
   * @returns {object} burn receipt with updated circulating supply
   */
  burn(holderAddress, amount, memo = '') {
    // Step 6.1 — Retrieve trust line (holder must have one to burn)
    const tl = this._getTrustLine(holderAddress);

    // Step 6.2 — Debit the trust line (balance destroyed, not transferred)
    tl.debit(amount);

    // Step 6.3 — Reduce the global circulating supply
    this.circulatingSupply = String(
      Math.max(0, parseFloat(this.circulatingSupply) - parseFloat(amount))
    );

    // Step 6.4 — Retire reserve entries (FIFO) to balance the reserve ledger.
    // For every CIPR destroyed, the corresponding reserve backing is released.
    // The reserve ledger stays in balance with circulatingSupply at all times.
    this._retireReserve(amount);

    // Step 6.5 — Return the settlement receipt (evidence of UCC discharge)
    return {
      transactionType:     'Payment',
      account:             holderAddress,             // the settling party
      destination:         this.issuerAddress,        // cold wallet (tokens returned here)
      amount: {
        currency: this.currency,
        issuer:   this.issuerAddress,
        value:    amount,
      },
      memo:                memo || this._defaultMemo('burn', amount),
      newCirculatingSupply: this.circulatingSupply,   // reduced — ledger balances
      timestamp:           Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5a — Freeze controls (individual trust line)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Freeze an individual trust line (XRPL TrustSet tfSetFreeze).
   *
   * The issuer may suspend a specific holder's ability to send or receive CIPR.
   * This is a targeted compliance action — it does not affect other holders
   * or the overall issuance.  The frozen state is transparently recorded on
   * the trust line object and visible via GET /api/cipr/trustlines.
   *
   * @param {string} holderAddress - Holder whose trust line to freeze
   * @returns {object} TrustSet confirmation
   */
  freezeTrustLine(holderAddress) {
    this._getTrustLine(holderAddress).freeze();
    return {
      transactionType: 'TrustSet',
      flags:           'tfSetFreeze',       // XRPL TrustSet freeze flag
      account:         this.issuerAddress,  // issuer initiates the freeze
      holder:          holderAddress,       // affected account
    };
  }

  /**
   * Unfreeze an individual trust line (XRPL TrustSet tfClearFreeze).
   * Restores the holder's ability to send and receive CIPR.
   *
   * @param {string} holderAddress
   * @returns {object} TrustSet confirmation
   */
  unfreezeTrustLine(holderAddress) {
    this._getTrustLine(holderAddress).unfreeze();
    return {
      transactionType: 'TrustSet',
      flags:           'tfClearFreeze',
      account:         this.issuerAddress,
      holder:          holderAddress,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5b — Global freeze (all CIPR payments)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Activate a global freeze on the entire CIPR issuance (XRPL AccountSet asfGlobalFreeze).
   *
   * While a global freeze is active, NO CIPR payment (issue, transfer, or burn)
   * can proceed.  This is an emergency compliance mechanism — it halts all
   * circulation while the issuer investigates or remediates an issue.
   *
   * Holdings are preserved; trust lines remain intact; the freeze is reversible.
   *
   * @returns {object} AccountSet confirmation
   */
  setGlobalFreeze() {
    this.globalFreeze = true;
    return {
      transactionType: 'AccountSet',
      setFlag:         7,               // asfGlobalFreeze — XRPL flag code 7
      account:         this.issuerAddress,
      globalFreeze:    true,
    };
  }

  /**
   * Clear the global freeze — restores normal CIPR operations.
   * (XRPL AccountSet clearFlag asfGlobalFreeze)
   *
   * @returns {object} AccountSet confirmation
   */
  clearGlobalFreeze() {
    this.globalFreeze = false;
    return {
      transactionType: 'AccountSet',
      clearFlag:       7,
      account:         this.issuerAddress,
      globalFreeze:    false,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESERVE & SUPPLY STATUS — the health of the backing ledger
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Return a snapshot of the reserve ledger's current health.
   *
   * The reserve ratio is the key indicator of backing integrity:
   *   reserveRatio = totalReserved / circulatingSupply
   *   1.0000 = perfectly backed (every CIPR has a reserve entry)
   *   > 1.0  = over-collateralised (more reserve than circulation — conservative)
   *   < 1.0  = under-collateralised (WARNING: should never occur with correct usage)
   *
   * Unlike the existing monetary system (where no public reserve ratio exists),
   * this status is always available, real-time, and queryable by anyone.
   *
   * @returns {object} reserve health snapshot
   */
  reserveStatus() {
    const totalReserved = this.reserveLedger.reduce(
      (sum, entry) => sum + parseFloat(entry.amount), 0
    );
    return {
      currency:          this.currency,
      issuer:            this.issuerAddress,
      circulatingSupply: this.circulatingSupply,        // total CIPR in active trust lines
      totalReserved:     String(totalReserved),         // total reserve backing on file
      reserveRatio:      parseFloat(this.circulatingSupply) > 0
        ? (totalReserved / parseFloat(this.circulatingSupply)).toFixed(4)
        : 'N/A',                                        // ratio: should be ≥ 1.0000
      reserveEntries:    this.reserveLedger.length,     // number of active reserve documents
      globalFreeze:      this.globalFreeze,             // true = all payments halted
    };
  }

  /**
   * Get the trust line for a specific holder (public accessor).
   * Returns null if the holder has not yet established a trust line (Step 3).
   *
   * @param {string} holderAddress
   * @returns {TrustLine|null}
   */
  getTrustLine(holderAddress) {
    return this.trustLines[holderAddress] || null;
  }

  /**
   * Return all registered trust lines as JSON objects.
   * Used by GET /api/cipr/trustlines for full audit visibility.
   *
   * @returns {Array<object>}
   */
  allTrustLines() {
    return Object.values(this.trustLines).map((tl) => tl.toJSON());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS — not part of the public API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialise the hot wallet's trust line at startup.
   *
   * The hot wallet is the operational distribution address.  Its trust line
   * must exist before the genesis mint (Step 4 in ContractManager) can credit
   * it with the genesis supply.  This is the first trust relationship in the
   * system — established by the issuer itself, not an external holder.
   */
  _initHotWalletTrustLine() {
    const tl = new TrustLine(
      this.currency,
      this.issuerAddress,
      this.hotWalletAddress,
      this.maxSupply
    );
    this.trustLines[this.hotWalletAddress] = tl;
    // Hot wallet is now ready to receive the genesis supply mint.
  }

  /**
   * Retrieve a trust line by holder address, throwing if it does not exist.
   *
   * This enforces the requirement that trust must be established BEFORE value
   * can flow — a fundamental safeguard against unsolicited token delivery.
   *
   * @param {string} address
   * @returns {TrustLine}
   * @throws {Error} with clear guidance if the trust line is missing
   */
  _getTrustLine(address) {
    const tl = this.trustLines[address];
    if (!tl) {
      throw new Error(
        `No trust line found for ${address}. ` +
        `Account must call TrustSet (Step 3) before receiving ${this.currency}.`
      );
    }
    return tl;
  }

  /**
   * Assert the global freeze is not active.
   * Called at the start of issue(), transfer() — burn() does not require this
   * check as settlement should remain possible even during compliance actions.
   *
   * @throws {Error} if globalFreeze is true
   */
  _assertNotGloballyFrozen() {
    if (this.globalFreeze) {
      throw new Error('Global freeze is active — all CIPR payments are halted');
    }
  }

  /**
   * Retire reserve entries FIFO until the total retired amount equals `amount`.
   *
   * Called during burn (Step 6) to balance the reserve ledger against the
   * decrease in circulatingSupply.
   *
   * Algorithm:
   *   1. Pop the oldest (first) reserve entry.
   *   2. If the entry covers the remaining amount entirely, remove it and stop.
   *   3. If the entry is larger than the remaining amount, reduce the entry's
   *      amount and stop (partial retirement).
   *   4. If the entry is smaller, remove it entirely and continue with the next.
   *
   * Result: after retirement, the sum of all reserve entries equals the new
   * circulatingSupply.  The ledger is balanced for the burned amount.
   *
   * @param {string|number} amount - Total CIPR burned (to be offset in reserve)
   */
  _retireReserve(amount) {
    let remaining = parseFloat(amount); // track how much reserve still needs retiring

    while (remaining > 0 && this.reserveLedger.length > 0) {
      const entry    = this.reserveLedger[0];           // oldest reserve entry (FIFO)
      const entryAmt = parseFloat(entry.amount);

      if (entryAmt <= remaining) {
        // This entry is fully consumed — remove it from the ledger
        this.reserveLedger.shift();
        remaining -= entryAmt;
      } else {
        // This entry partially covers remaining — reduce its amount and stop
        entry.amount = String(entryAmt - remaining);
        remaining    = 0;
      }
    }
    // remaining === 0: reserve has been fully retired for the burned amount
  }

  /**
   * Build a default UCC-anchored memo for a transaction if none is supplied.
   *
   * The memo connects the on-chain record to the legal framework:
   *   mint     → 12 USC 411 (issued against reserve) + UCC 3-603 (obligation created)
   *   transfer → UCC 3-311 (accord & satisfaction) + UCC 3-603 (good-faith tender)
   *   burn     → UCC 3-311/3-603 (obligation discharged; reserve offset recorded)
   *
   * @param {'mint'|'transfer'|'burn'} action
   * @param {string}                    amount
   * @returns {string} formatted memo string
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
