'use strict';

/**
 * ProtocolService — the CipherNex CIPR Lifecycle Microservice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * This microservice exposes the complete six-step CIPR lifecycle as a dedicated
 * REST API.  Each endpoint corresponds to a distinct step in the issuance and
 * settlement process, making the flow explicit, auditable, and interactive for
 * any developer, auditor, or participant exploring the CipherNex protocol.
 *
 * The service is designed to be PUBLIC-FACING and EDUCATIONAL:
 *   — Every response includes a `legalAnchor` field naming the UCC / statutory
 *     basis for that step, connecting code execution to legal framework.
 *   — Every response includes a `next` field with the recommended next action,
 *     required request body, and a ready-to-run curl command.
 *   — POST /protocol/run executes all six steps automatically so any caller
 *     can observe the complete lifecycle in a single request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIX-STEP CIPR LIFECYCLE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   STEP 1 — Genesis       GET  /protocol/genesis
 *   ─────────────────────────────────────────────
 *   At node startup, ContractManager mints the full genesis supply to the hot
 *   wallet, backed by 'GENESIS-RESERVE-001'.  This endpoint returns a snapshot
 *   of that initial reserve state.  The genesis step is the anchor: substance
 *   exists BEFORE any tokens enter circulation.
 *   Legal anchor: 12 USC 411 — issued against reserve held in trust.
 *
 *   STEP 2 — Account       POST /protocol/account
 *   ─────────────────────────────────────────────
 *   A new wallet (secp256k1 public/private key pair) is generated for a
 *   prospective CIPR holder.  At this stage the wallet CANNOT hold CIPR —
 *   consent (a trust line) must be established first.  This mirrors the
 *   principle that obligation cannot be imposed; the holder must choose to enter.
 *
 *   STEP 3 — TrustSet      POST /protocol/trustset
 *   ─────────────────────────────────────────────
 *   The holder voluntarily opens a trust line toward the cold wallet issuer,
 *   specifying the maximum CIPR they will accept (limit).  This is the consent
 *   step — no CIPR can arrive at this address until TrustSet is called.
 *   Legal anchor: AccountSet asfDefaultRipple — trust line opened toward issuer.
 *
 *   STEP 4 — Issue         POST /protocol/issue
 *   ─────────────────────────────────────────────
 *   The issuer mints CIPR to the holder's trust line.  A `reserveReference`
 *   (document ID / asset reference) is REQUIRED — it links this mint to the
 *   real-world substance backing the token.  The reserve ledger is updated 1:1.
 *   Legal anchor: 12 USC 411 (issued against trust reserve); UCC 3-603
 *   (obligation created upon issuance — good-faith tender established).
 *
 *   STEP 5 — Transfer      POST /protocol/transfer
 *   ─────────────────────────────────────────────
 *   The holder sends CIPR to another holder (peer-to-peer settlement).  Both
 *   parties must have trust lines.  The transfer is final — no reversal is
 *   possible without a new transaction.  Optional transfer fees (basis points)
 *   are applied at this stage if configured.
 *   Legal anchor: UCC 3-603 — payment tendered between holders; good-faith transfer.
 *
 *   STEP 6 — Settle        POST /protocol/settle
 *   ─────────────────────────────────────────────
 *   The holder burns (returns) CIPR to the cold wallet issuer.  The tokens are
 *   destroyed; the circulating supply decreases; the corresponding reserve
 *   entry is retired FIFO.  The ledger truly balances — substance in, substance out.
 *   This is the crucial step that distinguishes CIPR from the FRN circular loop:
 *   the settlement instrument (CIPR) actually retires the obligation rather than
 *   recirculating it as another liability.
 *   Legal anchor: UCC 3-311 (accord & satisfaction) + UCC 3-603 (tender accepted;
 *   obligation discharged; reserve offset recorded).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SUPPORT ROUTES
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /protocol/reserve            Reserve health (ratio, supply, entries)
 *   GET  /protocol/balance/:address   Trust line balance for a holder
 *   GET  /protocol/trustlines         All registered trust lines (full audit view)
 *   POST /protocol/run                Automated end-to-end lifecycle demo
 *   GET  /                            Interactive service index + curl examples
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PORT CONFIGURATION
 * ─────────────────────────────────────────────────────────────────────────────
 *   Default: 3002.  Override with PROTOCOL_PORT environment variable.
 *   Enable: set PROTOCOL_SERVICE_ENABLED=true before starting the node.
 */

const express    = require('express');
const bodyParser = require('body-parser');
const crypto     = require('crypto');
const { bufferToHex, privateToAddress } = require('ethereumjs-util');

class ProtocolService {
  /**
   * Construct the protocol microservice.
   *
   * Injects the Blockchain (public ledger) and ContractManager (which holds
   * the CIPRIssuance controller — the private trust/reserve ledger).
   * Together these two objects represent the dual-ledger architecture.
   *
   * @param {import('../blockchain/Blockchain')}       blockchain       - Public chain
   * @param {import('../blockchain/ContractManager')}  contractManager  - Token registry
   */
  constructor(blockchain, contractManager) {
    this.blockchain = blockchain;
    // cipr is the CIPR issuance controller — trust lines, reserve ledger,
    // circulating supply, and all lifecycle methods are accessed through this.
    this.cipr = contractManager.ciprIssuance;

    this.app = express();
    this.app.use(bodyParser.json());
    this._registerRoutes();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API — start the microservice
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start the HTTP server and bind to the given port.
   * Logs the service URL and key entry points to the console at startup.
   *
   * @param {number} port - Port to listen on (default: 3002)
   */
  start(port) {
    this.app.listen(port, () => {
      console.log(`[ProtocolService] CipherNex Protocol Microservice → http://localhost:${port}`);
      console.log(`[ProtocolService] Full lifecycle demo            → POST http://localhost:${port}/protocol/run`);
      console.log(`[ProtocolService] Interactive docs               → GET  http://localhost:${port}/`);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  _registerRoutes() {

    // ──────────────────────────────────────────────────────────────────────────
    // SERVICE INDEX  GET /
    // Returns a structured directory of all endpoints with sample payloads.
    // This is the entry point for anyone exploring the CipherNex protocol.
    // ──────────────────────────────────────────────────────────────────────────
    this.app.get('/', (req, res) => {
      res.json({
        service:   'CipherNex Protocol Microservice',
        version:   '1.0.0',
        network:   this.blockchain.networkName,
        chainId:   this.blockchain.chainId,
        currency:  this.cipr.currency,
        issuer:    this.cipr.issuerAddress,   // cold wallet — mint authority
        hotWallet: this.cipr.hotWalletAddress, // operational distribution wallet
        endpoints: {
          'GET  /protocol/genesis':           'Step 1 — Genesis reserve status (established at startup)',
          'POST /protocol/account':           'Step 2 — Create wallet (no trust line yet)',
          'POST /protocol/trustset':          'Step 3 — Establish CIPR trust line (consent step)',
          'POST /protocol/issue':             'Step 4 — Mint CIPR (1:1 backed by reserveReference)',
          'POST /protocol/transfer':          'Step 5 — Holder-to-holder payment (peer settlement)',
          'POST /protocol/settle':            'Step 6 — Burn + retire reserve (UCC 3-311/3-603 discharge)',
          'GET  /protocol/reserve':           'Reserve health — ratio, supply, entry count',
          'GET  /protocol/balance/:address':  'Trust line balance for a specific holder',
          'GET  /protocol/trustlines':        'All registered trust lines (full audit view)',
          'POST /protocol/run':               'Automated full lifecycle demo (Genesis → Settlement)',
        },
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1 — Genesis   GET /protocol/genesis
    //
    // This step is executed automatically at node startup by ContractManager.
    // The genesis allocation is the foundation of the entire ledger:
    //   — Full genesis supply minted to the hot wallet
    //   — Backed by 'GENESIS-RESERVE-001' (trust corpus document)
    //   — Legal anchor: 12 USC 411 — issued against reserve held in trust
    //
    // This endpoint returns the CURRENT state of that initial allocation,
    // including the reserve ratio (should be 1.0000 at genesis).
    // ──────────────────────────────────────────────────────────────────────────
    this.app.get('/protocol/genesis', (req, res) => {
      // Retrieve the live reserve status — supply, ratio, entry count
      const status = this.cipr.reserveStatus();
      res.json({
        step:             1,
        name:             'Genesis',
        description:
          'At node startup, ContractManager minted the genesis CIPR supply to the hot ' +
          'wallet, backed by the trust corpus reserve document (GENESIS-RESERVE-001). ' +
          'Substance existed before circulation — the backing predates the token.',
        legalAnchor:      '12 USC 411 — genesis reserve allocation; UCC 3-603 tender established',
        reserveReference: 'GENESIS-RESERVE-001',  // the trust document backing genesis supply
        issuer:           this.cipr.issuerAddress,    // cold wallet (mint authority)
        hotWallet:        this.cipr.hotWalletAddress, // receives and distributes genesis supply
        reserve:          status,                     // live: supply, ratio, entry count
        next: {
          // Step 2: create a holder wallet before establishing a trust line
          step:   2,
          action: 'POST /protocol/account',
          body:   {},
        },
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2 — Account Creation   POST /protocol/account
    //
    // Generates a new secp256k1 wallet (the same curve used by Bitcoin and
    // Ethereum) for a prospective CIPR holder.
    //
    // IMPORTANT: at this stage the wallet CANNOT hold CIPR.  The holder must
    // first establish a trust line (Step 3) — this is the consent requirement.
    // No obligation is imposed; no tokens arrive uninvited.
    //
    // Response includes the address and private key.  In production deployments
    // the private key should be handled by the client and NEVER stored server-side.
    // ──────────────────────────────────────────────────────────────────────────
    this.app.post('/protocol/account', (req, res) => {
      const wallet = this._createWallet(); // generate secp256k1 keypair
      res.json({
        step:        2,
        name:        'Account',
        status:      'success',
        description:
          'A new wallet has been created.  It cannot hold CIPR until the holder ' +
          'voluntarily establishes a trust line (Step 3 — TrustSet).  ' +
          'No obligation is imposed; the holder chooses to enter the relationship.',
        wallet,  // { address, privateKey } — keep the private key secure
        next: {
          step:   3,
          action: 'POST /protocol/trustset',
          body:   { holderAddress: wallet.address, limit: '100000000000' },
          // Ready-to-run curl command for the next step:
          curl: [
            `curl -X POST http://localhost:${this._port}/protocol/trustset \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{ "holderAddress": "${wallet.address}", "limit": "100000000000" }'`,
          ].join('\n'),
        },
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3 — TrustSet   POST /protocol/trustset
    //
    // The holder voluntarily establishes a trust line toward the CIPR cold
    // wallet issuer, declaring: "I accept up to [limit] CIPR from this issuer."
    //
    // This is the CONSENT step.  Without a trust line:
    //   — The issuer cannot mint CIPR to this address (Step 4 will throw).
    //   — The address cannot receive CIPR from any other holder (Step 5 will throw).
    //
    // Request body:
    //   holderAddress  (required) — the wallet created in Step 2
    //   limit          (optional) — max CIPR accepted; defaults to maxSupply
    //
    // Legal anchor: AccountSet asfDefaultRipple — the issuer's DefaultRipple flag
    // enables trust-line-based rippling, allowing peer-to-peer CIPR flow (Step 5).
    // ──────────────────────────────────────────────────────────────────────────
    this.app.post('/protocol/trustset', (req, res) => {
      try {
        const { holderAddress, limit } = req.body;
        if (!holderAddress) throw new Error('holderAddress is required');

        // Register the trust line in CIPRIssuance — holder is now eligible to receive CIPR
        const tl = this.cipr.trustSet(holderAddress, limit);

        res.json({
          step:        3,
          name:        'TrustSet',
          status:      'success',
          description:
            'Trust line established.  The holder has consented to receive CIPR from the ' +
            'cold wallet issuer, up to the declared limit.  The issuer may now mint ' +
            'CIPR to this address (Step 4 — Issue).',
          legalAnchor:     'AccountSet asfDefaultRipple — trust line opened toward cold wallet issuer',
          transactionType: 'TrustSet',
          trustLine:       tl.toJSON(), // full trust line state including limit, balance, frozen flag
          next: {
            step:   4,
            action: 'POST /protocol/issue',
            body: {
              destinationAddress: holderAddress,
              amount:             '1000',
              reserveReference:   'RESERVE-DOC-2026-001', // must be a real document reference
              memo:               '12 USC 411 — issued against trust reserve',
            },
            curl: [
              `curl -X POST http://localhost:${this._port}/protocol/issue \\`,
              `  -H "Content-Type: application/json" \\`,
              `  -d '{ "destinationAddress": "${holderAddress}", "amount": "1000",`,
              `       "reserveReference": "RESERVE-DOC-2026-001" }'`,
            ].join('\n'),
          },
        });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4 — Issue (Mint)   POST /protocol/issue
    //
    // The cold wallet issuer mints CIPR to a trust-line holder.  This is the
    // moment new CIPR enters circulation.
    //
    // CRITICAL REQUIREMENT: reserveReference must be provided.
    //   Every CIPR minted must be backed by a documented reserve entry.
    //   This is what distinguishes CIPR from FRN creation (where currency is
    //   created by bookkeeping entry alone, backed only by "faith and credit").
    //   The reserveReference is the pointer to the real-world substance.
    //
    // After this step:
    //   — Holder's trust line balance increases by `amount`
    //   — A new entry appears in the reserve ledger: { reference, amount, destination }
    //   — circulatingSupply increases by `amount`
    //   — reserveRatio remains 1.0000 (substance matches circulation)
    //
    // Request body:
    //   destinationAddress  (required) — must have a trust line from Step 3
    //   amount              (required) — CIPR to mint (string; preserves precision)
    //   reserveReference    (required) — document/asset ID backing this mint
    //   memo                (optional) — additional legal/UCC context
    //
    // Legal anchor: 12 USC 411 (issued against trust reserve); UCC 3-603
    // (obligation created upon presentment — the mint IS the tender).
    // ──────────────────────────────────────────────────────────────────────────
    this.app.post('/protocol/issue', (req, res) => {
      try {
        const { destinationAddress, amount, reserveReference, memo } = req.body;

        // All three required fields must be present — no substance-free minting
        if (!destinationAddress || !amount || !reserveReference) {
          throw new Error('destinationAddress, amount, and reserveReference are required');
        }

        // Execute the mint: trust line credited, reserve entry created
        const receipt = this.cipr.issue(destinationAddress, String(amount), reserveReference, memo);
        const tl      = this.cipr.getTrustLine(destinationAddress);

        res.json({
          step:        4,
          name:        'Issue',
          status:      'success',
          description:
            'CIPR minted to the holder\'s trust line.  A corresponding reserve entry ' +
            'has been created in the reserve ledger (1:1 backing).  Substance existed ' +
            'before the token arrived — the reserve reference documents the real backing.',
          legalAnchor:       '12 USC 411 — issued against assets held in trust; UCC 3-603 obligation created',
          ...receipt,                              // transactionType, account, destination, amount, reserveEntry
          trustLineBalance:  tl ? tl.balance : null, // holder's current CIPR balance
          next: {
            step:   5,
            action: 'POST /protocol/transfer',
            body: {
              fromAddress: destinationAddress,
              toAddress:   '<second-holder-address-with-trust-line>',
              amount:      String(Math.floor(parseFloat(amount) / 2)),
              memo:        'Holder-to-holder payment',
            },
          },
        });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5 — Transfer   POST /protocol/transfer
    //
    // The holder sends CIPR to another holder — peer-to-peer settlement.
    // This is substantive value transfer: the sending trust line is debited
    // and the receiving trust line is credited.  Unlike the FRN system (where
    // "value" merely shifts liability), CIPR actually moves between holders.
    //
    // Both parties must have active (non-frozen) trust lines.
    // The transfer is final — no central authority can reverse it.
    //
    // If transferRate > 0 (basis points), a fee is retained by the issuer:
    //   Sender debited: grossAmount
    //   Receiver credited: grossAmount - fee (= netAmount)
    //   Default: transferRate = 0 (feeless)
    //
    // Request body:
    //   fromAddress  (required) — sending holder (must have trust line + balance)
    //   toAddress    (required) — receiving holder (must have trust line)
    //   amount       (required) — gross CIPR to send
    //   memo         (optional) — description / legal context
    //
    // Legal anchor: UCC 3-603 — payment tendered between holders; good-faith transfer.
    // The transfer is a bilateral settlement — both parties' ledgers update atomically.
    // ──────────────────────────────────────────────────────────────────────────
    this.app.post('/protocol/transfer', (req, res) => {
      try {
        const { fromAddress, toAddress, amount, memo } = req.body;
        if (!fromAddress || !toAddress || !amount) {
          throw new Error('fromAddress, toAddress, and amount are required');
        }

        // Execute peer-to-peer transfer — both trust lines update atomically
        const receipt = this.cipr.transfer(fromAddress, toAddress, String(amount), memo);
        const fromTl  = this.cipr.getTrustLine(fromAddress);
        const toTl    = this.cipr.getTrustLine(toAddress);

        res.json({
          step:        5,
          name:        'Transfer',
          status:      'success',
          description:
            'CIPR transferred between holders.  Both trust lines updated atomically. ' +
            'This is substantive peer-to-peer settlement — the sending trust line is ' +
            'debited and the receiving trust line is credited.  The transfer is final.',
          legalAnchor:          'UCC 3-603 — payment tendered between holders; good-faith transfer',
          ...receipt,           // transactionType, from, to, grossAmount, fee, netAmount, currency, memo
          postTransferBalances: {
            // Post-transfer snapshot for immediate audit verification
            [fromAddress]: fromTl ? fromTl.balance : null,
            [toAddress]:   toTl   ? toTl.balance   : null,
          },
          next: {
            // Step 6: the receiver can now settle (burn) their CIPR to discharge the obligation
            step:   6,
            action: 'POST /protocol/settle',
            body: {
              holderAddress: toAddress,
              amount:        receipt.netAmount,
              memo:          'UCC 3-311 — accord & satisfaction; obligation discharged',
            },
            curl: [
              `curl -X POST http://localhost:${this._port}/protocol/settle \\`,
              `  -H "Content-Type: application/json" \\`,
              `  -d '{ "holderAddress": "${toAddress}", "amount": "${receipt.netAmount}" }'`,
            ].join('\n'),
          },
        });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 6 — Settle (Burn)   POST /protocol/settle
    //
    // The holder returns CIPR to the cold wallet issuer — completing the lifecycle.
    // This is the most important step: it demonstrates that CIPR is a TRUE
    // settlement instrument, not a circular debt note.
    //
    // What happens on settlement:
    //   1. Holder's trust line is DEBITED (tokens destroyed, not transferred)
    //   2. circulatingSupply DECREASES by the burned amount
    //   3. Reserve entries are RETIRED FIFO until the burned amount is covered
    //   4. The ledger genuinely balances — substance in, substance out
    //
    // Contrast with the FRN system:
    //   FRNs returned to the Federal Reserve simply cancel one liability against
    //   another — no substance leaves, no obligation is retired, the loop
    //   continues.  CIPR settlement ACTUALLY closes the record.
    //
    // Legal anchors:
    //   UCC 3-311 — Accord & Satisfaction: the holder's CIPR tender satisfies
    //               the obligation in full.  Substance for substance.
    //   UCC 3-603 — Tender of Payment: good-faith presentment discharges the duty.
    //               The reserve offset is the evidence of discharge.
    //
    // Request body:
    //   holderAddress  (required) — holder returning CIPR (must have trust line + balance)
    //   amount         (required) — CIPR to burn/return
    //   memo           (optional) — UCC discharge context (auto-generated if omitted)
    // ──────────────────────────────────────────────────────────────────────────
    this.app.post('/protocol/settle', (req, res) => {
      try {
        const { holderAddress, amount, memo } = req.body;
        if (!holderAddress || !amount) {
          throw new Error('holderAddress and amount are required');
        }

        // Execute burn: trust line debited, supply reduced, reserve retired
        const receipt = this.cipr.burn(
          holderAddress,
          String(amount),
          memo || 'UCC 3-311 / UCC 3-603 — accord & satisfaction; obligation discharged'
        );

        // Capture post-settlement reserve state for audit visibility
        const reserve = this.cipr.reserveStatus();

        res.json({
          step:        6,
          name:        'Settlement',
          status:      'success',
          description:
            'CIPR burned and returned to the cold wallet issuer.  The tokens have been ' +
            'destroyed (trust line debited); circulating supply reduced; corresponding ' +
            'reserve entries retired FIFO.  The ledger balances — substance in, substance out. ' +
            'This is true settlement, not circular discharge.',
          legalAnchor:
            'UCC 3-311 / UCC 3-603 — tender accepted; obligation satisfied in full; ' +
            'reserve offset recorded as evidence of discharge',
          ...receipt, // transactionType, account, destination (issuer), amount, memo, newCirculatingSupply
          postSettlementReserve: {
            // Reserve health after settlement — confirms ledger balance
            circulatingSupply: reserve.circulatingSupply, // reduced by burned amount
            totalReserved:     reserve.totalReserved,     // reserve entries retired accordingly
            reserveRatio:      reserve.reserveRatio,      // should remain ≥ 1.0000
            remainingEntries:  reserve.reserveEntries,    // active reserve documents remaining
          },
        });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // SUPPORT ROUTES — audit, monitoring, and inspection
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * GET /protocol/reserve
     * Returns the live reserve health snapshot.
     * Key metric: reserveRatio should always be ≥ 1.0000 (fully backed).
     * Unlike the existing monetary system, this data is always available,
     * real-time, and accessible to anyone without special access.
     */
    this.app.get('/protocol/reserve', (req, res) => {
      res.json(this.cipr.reserveStatus());
    });

    /**
     * GET /protocol/balance/:address
     * Returns the trust line balance for a specific holder.
     * Includes limit, frozen status, and currency — full account state.
     * Returns 404 if no trust line exists for this address (Step 3 not yet done).
     */
    this.app.get('/protocol/balance/:address', (req, res) => {
      const tl = this.cipr.getTrustLine(req.params.address);
      if (!tl) {
        return res.status(404).json({
          error: 'No trust line found for this address',
          hint:  'The holder must call POST /protocol/trustset (Step 3) first',
        });
      }
      res.json({
        address:  req.params.address,
        currency: tl.currency,   // 'CIPR'
        balance:  tl.balance,    // current CIPR held (string, full precision)
        limit:    tl.limit,      // maximum CIPR accepted (self-imposed by holder)
        frozen:   tl.frozen,     // true = suspended by issuer (transparent flag)
      });
    });

    /**
     * GET /protocol/trustlines
     * Returns all registered trust lines as a full audit view.
     * Every account that has ever established a trust line (Step 3) appears here.
     * This is the complete map of consent relationships on the issuance.
     */
    this.app.get('/protocol/trustlines', (req, res) => {
      res.json({ trustLines: this.cipr.allTrustLines() });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // POST /protocol/run  — Full Automated Lifecycle Demo
    //
    // Executes all six steps programmatically and returns a structured report.
    // This is the quickest way to observe the complete CIPR lifecycle:
    //   Step 1 — Genesis snapshot
    //   Step 2 — Two holder wallets created
    //   Step 3 — Trust lines for both holders
    //   Step 4 — 10,000 CIPR minted to holder1
    //   Step 5 — 5,000 CIPR transferred: holder1 → holder2
    //   Step 6 — 5,000 CIPR burned by holder2 (full UCC settlement)
    //
    // Use this endpoint to verify the full protocol flow, observe reserve
    // balance throughout, and confirm the ledger zeros correctly at settlement.
    // ──────────────────────────────────────────────────────────────────────────
    this.app.post('/protocol/run', (req, res) => {
      try {
        res.json(this._runLifecycle());
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE RUNNER — orchestrates all six steps programmatically
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute the complete six-step CIPR lifecycle in sequence and return a
   * structured report documenting every step, balance, and reserve state.
   *
   * This runner is called by POST /protocol/run and is also used internally
   * by the lifecycle test suite (scripts/lifecycle-test.js).
   *
   * Lifecycle executed:
   *   Step 1 — Genesis snapshot (already established at startup)
   *   Step 2 — Two holder wallets created (holder1, holder2)
   *   Step 3 — Trust lines established for both holders
   *   Step 4 — 10,000 CIPR minted to holder1 (backed by a live reserve reference)
   *   Step 5 — 5,000 CIPR transferred: holder1 → holder2
   *   Step 6 — 5,000 CIPR burned by holder2 (full settlement; reserve retired)
   *
   * Expected final state:
   *   holder1 balance: 5,000 CIPR (held 10,000; sent 5,000)
   *   holder2 balance: 0 CIPR    (received 5,000; burned 5,000)
   *   circulatingSupply: genesis supply + 5,000 (10,000 issued, 5,000 retired)
   *   reserveRatio: 1.0000 (backing tracks circulation)
   *
   * @returns {object} structured lifecycle report with all steps and final summary
   */
  _runLifecycle() {
    const executedAt = new Date().toISOString();
    const steps      = [];

    // ── STEP 1 — Genesis (already established at node startup) ───────────────
    // Capture the current reserve state to show the starting point.
    // The genesis supply is already in circulation, backed by 'GENESIS-RESERVE-001'.
    const genesisReserve = this.cipr.reserveStatus();
    steps.push({
      step:              1,
      name:              'Genesis',
      description:
        'ContractManager minted the full genesis supply to the hot wallet at node startup, ' +
        'backed by GENESIS-RESERVE-001 (trust corpus document).  Substance existed before ' +
        'circulation — the backing was established before the first token entered distribution.',
      issuer:            this.cipr.issuerAddress,
      hotWallet:         this.cipr.hotWalletAddress,
      circulatingSupply: genesisReserve.circulatingSupply,
      reserveEntries:    genesisReserve.reserveEntries,
    });

    // ── STEP 2 — Create two holder wallets ──────────────────────────────────
    // Generate fresh secp256k1 keypairs for both demo participants.
    // Neither can hold CIPR yet — they must establish trust lines first.
    const holder1 = this._createWallet();
    const holder2 = this._createWallet();
    steps.push({
      step:        2,
      name:        'Account',
      description:
        'Two holder wallets generated.  Neither wallet can hold CIPR until each holder ' +
        'voluntarily establishes a trust line (Step 3 — TrustSet).  Consent is required; ' +
        'obligation cannot be imposed.',
      holder1: { address: holder1.address },
      holder2: { address: holder2.address },
    });

    // ── STEP 3 — TrustSet for both holders ──────────────────────────────────
    // Both holders consent to receive CIPR by opening trust lines.
    // The trust line registry now contains entries for holder1 and holder2.
    const tl1 = this.cipr.trustSet(holder1.address, '100000000000');
    const tl2 = this.cipr.trustSet(holder2.address, '100000000000');
    steps.push({
      step:             3,
      name:             'TrustSet',
      description:
        'Both holders established trust lines toward the CIPR cold wallet issuer.  ' +
        'Each declared their acceptance limit (max CIPR they will hold).  ' +
        'The issuer can now mint CIPR to either address.',
      legalAnchor:      'AccountSet asfDefaultRipple — trust lines opened; consent established',
      holder1TrustLine: tl1.toJSON(),
      holder2TrustLine: tl2.toJSON(),
    });

    // ── STEP 4 — Issue 10,000 CIPR to holder1 ───────────────────────────────
    // Mint 10,000 CIPR to holder1 backed by a unique reserve reference.
    // The reference is timestamped to ensure uniqueness across lifecycle runs.
    const reserveRef   = `RESERVE-LIFECYCLE-${Date.now()}`;
    const issueReceipt = this.cipr.issue(
      holder1.address,
      '10000',
      reserveRef,
      `12 USC 411 — lifecycle demo issuance; ${executedAt}`
    );
    steps.push({
      step:             4,
      name:             'Issue',
      description:
        '10,000 CIPR minted to holder1.  A corresponding reserve entry was created ' +
        '(1:1 backing).  The reserve reference links this mint to a specific trust ' +
        'instrument — substance came first, circulation followed.',
      legalAnchor:      '12 USC 411 — issued against trust reserve; UCC 3-603 obligation created',
      reserveReference: reserveRef,              // the backing document reference
      ...issueReceipt,                           // full mint receipt
      holder1Balance:   this.cipr.getTrustLine(holder1.address).balance, // should be '10000'
    });

    // ── STEP 5 — Transfer 5,000 CIPR: holder1 → holder2 ────────────────────
    // holder1 sends half their balance to holder2.
    // This is peer-to-peer settlement — the reserve backing follows the token.
    const transferReceipt = this.cipr.transfer(
      holder1.address,
      holder2.address,
      '5000',
      'Lifecycle demo: holder-to-holder payment — UCC 3-603 tender'
    );
    steps.push({
      step:        5,
      name:        'Transfer',
      description:
        'holder1 transferred 5,000 CIPR to holder2.  Both trust lines updated atomically. ' +
        'This is substantive peer-to-peer settlement — the reserve backing moves with the token.',
      legalAnchor:          'UCC 3-603 — payment tendered between holders; good-faith transfer',
      ...transferReceipt,   // from, to, grossAmount, fee, netAmount
      postTransferBalances: {
        holder1: this.cipr.getTrustLine(holder1.address).balance, // should be '5000'
        holder2: this.cipr.getTrustLine(holder2.address).balance, // should be '5000'
      },
    });

    // ── STEP 6 — holder2 burns 5,000 CIPR (full UCC settlement) ────────────
    // holder2 returns their full balance to the issuer.
    // Tokens are destroyed; reserve entry retired; ledger balances.
    const burnReceipt  = this.cipr.burn(
      holder2.address,
      '5000',
      'UCC 3-311 / UCC 3-603 — accord & satisfaction; obligation discharged; ' +
      'reserve offset recorded as evidence of settlement'
    );
    const finalReserve = this.cipr.reserveStatus();
    steps.push({
      step:        6,
      name:        'Settlement',
      description:
        'holder2 burned 5,000 CIPR — returning it to the cold wallet issuer.  ' +
        'Tokens destroyed; circulating supply reduced; reserve entries retired FIFO.  ' +
        'The ledger balances: for every CIPR destroyed, the corresponding backing is released.  ' +
        'This is true settlement — not the circular discharge of the FRN debt system.',
      legalAnchor:
        'UCC 3-311 / UCC 3-603 — tender accepted; obligation satisfied in full; ' +
        'reserve offset recorded',
      ...burnReceipt, // account, destination (issuer), amount, newCirculatingSupply
      finalReserve: {
        circulatingSupply: finalReserve.circulatingSupply, // genesis + 5,000 (10,000 - 5,000 settled)
        totalReserved:     finalReserve.totalReserved,     // matches new circulation
        reserveRatio:      finalReserve.reserveRatio,      // should remain 1.0000
        remainingEntries:  finalReserve.reserveEntries,    // active reserve documents remaining
      },
    });

    // ── LIFECYCLE COMPLETE — return full structured report ───────────────────
    return {
      lifecycle:   'CipherNex Full Protocol Lifecycle',
      executedAt,
      steps,       // all six steps with full receipts and legal anchors
      summary: {
        // Final state of both holder wallets
        holder1:                 holder1.address,
        holder2:                 holder2.address,
        issued:                  10000,          // total CIPR minted in this run
        transferred:             5000,           // CIPR moved holder1 → holder2
        settled:                 5000,           // CIPR burned by holder2
        holder1RemainingBalance: this.cipr.getTrustLine(holder1.address).balance, // '5000'
        holder2RemainingBalance: this.cipr.getTrustLine(holder2.address).balance, // '0'
        // Reserve health: the ledger should remain in balance throughout
        finalCirculatingSupply:  finalReserve.circulatingSupply,
        reserveRatio:            finalReserve.reserveRatio, // should be 1.0000
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a new secp256k1 wallet (Ethereum-compatible).
   *
   * Uses 32 bytes of cryptographically secure random data as the private key.
   * The address is derived via Ethereum's address derivation (keccak256 of
   * the public key, take last 20 bytes) — compatible with MetaMask and standard
   * Ethereum tooling.
   *
   * Security note: the private key is returned ONCE in the response.  In
   * production, clients should generate wallets locally and never transmit
   * private keys over a network.
   *
   * @returns {{ address: string, privateKey: string }}
   */
  _createWallet() {
    const privateKey = crypto.randomBytes(32); // 256-bit cryptographic random key
    return {
      address:    bufferToHex(privateToAddress(privateKey)), // 0x-prefixed Ethereum address
      privateKey: bufferToHex(privateKey),                   // 0x-prefixed private key hex
    };
  }

  /**
   * Lazily resolve the protocol service port.
   * Available after start() is called; reads PROTOCOL_PORT env var or defaults to 3002.
   * Used in curl examples embedded in step response `next` fields.
   *
   * @returns {number}
   */
  get _port() {
    return process.env.PROTOCOL_PORT || 3002;
  }
}

module.exports = ProtocolService;
