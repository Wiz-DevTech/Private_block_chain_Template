/**
 * AdminGateway — the protected Trustee administration interface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * AdminGateway is the central command surface for the Wisdom Ignited Business
 * Trust Trustee.  Every action that requires the cold wallet's authority is
 * accessible here and here alone — guarded by the Trustee JWT issued by
 * AuthService.
 *
 * It does two things:
 *
 *   1. WRAPS existing CIPR endpoints with authentication, adding enforcement
 *      that the public API (APIServer, port 3001) does not have.  The public
 *      API's /api/cipr/issue is open — AdminGateway's /admin/cipr/issue is not.
 *
 *   2. ADDS new capabilities that don't exist anywhere else:
 *        — Document-linked issuance: mint CIPR against a DocumentService record
 *        — Bill of exchange composition: build a Transaction with UCC tender fields
 *        — Discharge evidence retrieval: get the UCC 3-311/3-603 record for any TX
 *        — Trustee dashboard: summary of reserve health, chain state, document register
 *        — Trustee member management: register/view core member Trustee roll
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE — DUAL LEDGER ADMINISTRATION
 * ─────────────────────────────────────────────────────────────────────────────
 * AdminGateway is injected with both the Blockchain (public ledger) and the
 * ContractManager (private trust/reserve ledger), as well as DocumentService.
 * This gives the Trustee a single interface that reads and writes BOTH ledgers:
 *
 *   PUBLIC LEDGER actions:
 *     GET  /admin/chain              — view settled blocks
 *     GET  /admin/chain/valid        — verify chain integrity
 *     POST /admin/chain/mine         — settle pending transactions
 *
 *   PRIVATE LEDGER (CIPR) actions:
 *     POST /admin/cipr/issue         — mint CIPR (with document linking)
 *     POST /admin/cipr/burn          — burn CIPR (with document retirement)
 *     POST /admin/cipr/freeze        — freeze/unfreeze individual trust line
 *     POST /admin/cipr/globalfreeze  — activate/clear global freeze
 *     GET  /admin/cipr/reserve       — reserve health snapshot
 *     GET  /admin/cipr/trustlines    — all trust relationships
 *     GET  /admin/cipr/trustline/:a  — specific trust line detail
 *
 *   DOCUMENT LEDGER actions:
 *     POST /admin/document           — enter a new trust instrument record
 *     GET  /admin/documents          — full document register
 *     GET  /admin/document/:id       — retrieve a specific record
 *
 *   BILL OF EXCHANGE:
 *     POST /admin/bill-of-exchange   — compose a UCC-anchored bill of exchange
 *                                      (creates document + Transaction structure)
 *     GET  /admin/discharge/:txHash  — retrieve UCC discharge evidence for a TX
 *
 *   TRUSTEE MEMBER ROLL:
 *     POST /admin/members            — register a core member (Trustee/Beneficiary)
 *     GET  /admin/members            — view the Trustee member roll
 *     GET  /admin/members/:address   — view a specific member
 *
 *   DASHBOARD:
 *     GET  /admin/dashboard          — full Trust operational summary
 *     GET  /                         — service index
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALL ROUTES REQUIRE TRUSTEE JWT
 * ─────────────────────────────────────────────────────────────────────────────
 * The trusteeAuth middleware is applied as the FIRST handler on every route.
 * No route handler executes unless the caller presents a valid, non-expired,
 * non-revoked Trustee token.
 */

'use strict';

const express    = require('express');
const bodyParser = require('body-parser');
const crypto     = require('crypto');
const { trusteeAuth } = require('../middleware/trusteeAuth');
const Transaction     = require('../blockchain/Transaction');
const config          = require('../config');

class AdminGateway {
  /**
   * Construct AdminGateway.
   *
   * @param {import('../blockchain/Blockchain')}       blockchain       — public chain
   * @param {import('../blockchain/ContractManager')}  contractManager  — CIPR + token registry
   * @param {import('./DocumentService')}              documentService  — trust document record keeper
   */
  constructor(blockchain, contractManager, documentService) {
    this.blockchain       = blockchain;
    this.cipr             = contractManager.ciprIssuance; // CIPR issuance controller
    this.contractManager  = contractManager;
    this.documentService  = documentService;

    this.app = express();
    this.app.use(bodyParser.json());

    // ── In-memory Trustee member roll ─────────────────────────────────────────
    // Stores registered core members (Trustees, Beneficiaries, Co-Trustees).
    // Map<address, member> — persisted in the response layer; future versions
    // may persist to /data/members.json using the same pattern as DocumentService.
    this._members = new Map();

    this._registerRoutes();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC — start the service
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start the HTTP server.
   * @param {number} port
   */
  start(port) {
    this.app.listen(port, () => {
      console.log(`[AdminGateway]    Trustee Admin Interface       → http://localhost:${port}`);
      console.log(`[AdminGateway]    Dashboard                    → GET  http://localhost:${port}/admin/dashboard`);
      console.log(`[AdminGateway]    Document register            → GET  http://localhost:${port}/admin/documents`);
      console.log(`[AdminGateway]    NOTE: all routes require Trustee JWT from AuthService`);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  _registerRoutes() {

    // ── Service index ─────────────────────────────────────────────────────────
    this.app.get('/', trusteeAuth, (req, res) => {
      res.json({
        service:   'CipherNex AdminGateway — Trustee Administration Interface',
        version:   '1.0.0',
        trustee:   req.trustee.sub,   // Trustee identity from JWT
        network:   this.blockchain.networkName,
        endpoints: {
          '── DASHBOARD ────────────────────────────────':              '',
          'GET  /admin/dashboard':                'Full operational summary (reserve, chain, documents)',
          '── CHAIN (Public Ledger) ───────────────────':              '',
          'GET  /admin/chain':                    'All settled blocks',
          'GET  /admin/chain/valid':              'Chain integrity verification',
          'POST /admin/chain/mine':               'Settle pending transactions into a block',
          '── CIPR (Private Ledger) ───────────────────':              '',
          'POST /admin/cipr/issue':               'Mint CIPR against a document (Step 4)',
          'POST /admin/cipr/burn':                'Burn CIPR + retire document (Step 6)',
          'POST /admin/cipr/freeze':              'Freeze/unfreeze individual trust line',
          'POST /admin/cipr/globalfreeze':        'Activate/clear global freeze',
          'GET  /admin/cipr/reserve':             'Reserve health — ratio, supply, entries',
          'GET  /admin/cipr/trustlines':          'All trust lines (consent relationships)',
          'GET  /admin/cipr/trustline/:address':  'Specific trust line detail',
          '── DOCUMENTS (Trust Instruments) ──────────':              '',
          'POST /admin/document':                 'Enter a trust instrument / bill of exchange record',
          'GET  /admin/documents':                'Full document register',
          'GET  /admin/document/:id':             'Retrieve a specific document record',
          '── BILL OF EXCHANGE ─────────────────────':               '',
          'POST /admin/bill-of-exchange':         'Compose a UCC-anchored bill of exchange (document + TX structure)',
          'GET  /admin/discharge/:txHash':        'Retrieve UCC discharge evidence for a transaction',
          '── TRUSTEE MEMBER ROLL ─────────────────────':            '',
          'POST /admin/members':                  'Register a core member (Trustee / Beneficiary)',
          'GET  /admin/members':                  'View the full Trustee member roll',
          'GET  /admin/members/:address':         'View a specific member',
        },
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // DASHBOARD — operational overview
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * GET /admin/dashboard
     *
     * The Trustee's operational overview.  Aggregates data from all three
     * ledgers (public chain, private CIPR reserve, document register) into
     * a single summary view.
     *
     * Shows at a glance:
     *   — Chain height and validity
     *   — CIPR circulating supply and reserve ratio
     *   — Active vs. retired document count
     *   — Trust member count
     *   — Global freeze status
     */
    this.app.get('/admin/dashboard', trusteeAuth, (req, res) => {
      const reserve       = this.cipr.reserveStatus();
      const trustLines    = this.cipr.allTrustLines();
      const allDocs       = Array.from(this.documentService['_documents'].values());
      const activeDocs    = allDocs.filter(d => d.status === 'active');
      const retiredDocs   = allDocs.filter(d => d.status === 'retired');
      const chainValid    = this.blockchain.isChainValid();

      res.json({
        trustee:          req.trustee.sub,
        generatedAt:      new Date().toISOString(),
        // ── Public ledger state ───────────────────────────────────────────
        chain: {
          height:         this.blockchain.chain.length,   // number of settled blocks
          isValid:        chainValid,                      // cryptographic integrity check
          pendingCount:   this.blockchain.pendingTransactions.length,
          networkName:    this.blockchain.networkName,
          chainId:        this.blockchain.chainId,
        },
        // ── CIPR private ledger state ────────────────────────────────────
        cipr: {
          currency:           reserve.currency,
          circulatingSupply:  reserve.circulatingSupply,
          totalReserved:      reserve.totalReserved,
          reserveRatio:       reserve.reserveRatio,        // should be ≥ 1.0000
          reserveEntries:     reserve.reserveEntries,
          trustLineCount:     trustLines.length,
          globalFreeze:       reserve.globalFreeze,
          issuer:             this.cipr.issuerAddress,
          hotWallet:          this.cipr.hotWalletAddress,
        },
        // ── Document register state ──────────────────────────────────────
        documents: {
          total:    allDocs.length,
          active:   activeDocs.length,    // outstanding / live obligations
          retired:  retiredDocs.length,   // discharged / settled records
        },
        // ── Trust member roll ────────────────────────────────────────────
        members: {
          count:    this._members.size,
        },
        // ── Alerts ───────────────────────────────────────────────────────
        alerts: [
          ...(reserve.globalFreeze
            ? [{ level: 'WARNING', message: 'Global freeze is ACTIVE — all CIPR payments are halted' }]
            : []),
          ...(!chainValid
            ? [{ level: 'CRITICAL', message: 'Chain integrity check FAILED — chain may have been tampered with' }]
            : []),
          ...(parseFloat(reserve.reserveRatio) < 1 && reserve.reserveRatio !== 'N/A'
            ? [{ level: 'CRITICAL', message: `Reserve ratio below 1:1 (${reserve.reserveRatio}) — under-collateralised` }]
            : []),
        ],
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // CHAIN — public ledger management
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * GET /admin/chain
     * Return the full settled block chain.  Each block contains the complete
     * transaction set that was mined into it.
     */
    this.app.get('/admin/chain', trusteeAuth, (req, res) => {
      res.json({
        height: this.blockchain.chain.length,
        chain:  this.blockchain.chain,
      });
    });

    /**
     * GET /admin/chain/valid
     * Run the chain integrity check.  Verifies that:
     *   - Every block's hash matches its recomputed hash (no tampering)
     *   - Every block's previousHash links correctly to the prior block
     *   - Every transaction with a fromAddress has a valid ECDSA signature
     */
    this.app.get('/admin/chain/valid', trusteeAuth, (req, res) => {
      const isValid = this.blockchain.isChainValid();
      res.json({
        isValid,
        height:  this.blockchain.chain.length,
        message: isValid
          ? 'Chain integrity verified — all hashes and signatures are valid'
          : 'CHAIN INTEGRITY FAILURE — one or more blocks have been tampered with',
      });
    });

    /**
     * POST /admin/chain/mine
     * Mine all pending transactions into a new settled block.
     * The Trustee's cold wallet address receives the mining reward.
     *
     * Body: { rewardAddress? }  — defaults to the Trustee's issuer address
     */
    this.app.post('/admin/chain/mine', trusteeAuth, (req, res) => {
      try {
        // Default reward address is the Trustee's cold wallet
        const rewardAddress = req.body.rewardAddress || config.CIPR_ISSUER_ADDRESS;
        const block         = this.blockchain.minePendingTransactions(rewardAddress);
        res.json({
          status:        'mined',
          blockHash:     block.hash,
          blockIndex:    this.blockchain.chain.length - 1,
          txCount:       block.transactions.length,
          rewardAddress,
        });
      } catch (err) {
        res.status(500).json({ error: 'Mining failed', detail: err.message });
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // CIPR — private ledger administration (protected wrappers)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * POST /admin/cipr/issue
     *
     * Mint CIPR from the cold wallet to a holder's trust line.
     * This is the DOCUMENT-LINKED version of the public /api/cipr/issue endpoint.
     *
     * If `documentId` is provided (preferred):
     *   — The document is looked up in DocumentService to confirm it exists and is active
     *   — The document's amount is used if `amount` is not explicitly provided
     *   — The documentId is used as the reserveReference (the link is automatic)
     *   — On success, the mint receipt is attached to the document record
     *
     * If only `reserveReference` is provided (fallback — same as public API):
     *   — CIPR is minted with that raw string as the reference
     *   — No document record lookup is performed
     *
     * Required body: { destinationAddress, documentId OR reserveReference, amount? }
     */
    this.app.post('/admin/cipr/issue', trusteeAuth, (req, res) => {
      try {
        const { destinationAddress, documentId, reserveReference, amount, memo } = req.body;

        if (!destinationAddress) {
          return res.status(400).json({ error: 'destinationAddress is required' });
        }

        let finalReserveRef = reserveReference;
        let finalAmount     = amount;
        let linkedDocument  = null;

        // ── Document-linked issuance (preferred path) ─────────────────────
        // If a documentId is provided, validate the document and use it as backing
        if (documentId) {
          linkedDocument = this.documentService.getDocument(documentId);
          if (!linkedDocument) {
            return res.status(404).json({
              error: `Document not found: ${documentId}`,
              hint:  'Enter the document first via POST /admin/document',
            });
          }
          if (linkedDocument.status === 'retired') {
            return res.status(409).json({
              error: 'Document is already retired — cannot mint against a closed record',
              documentId,
            });
          }
          // Use the documentId as the reserve reference (creates the link)
          finalReserveRef = documentId;
          // Use the document's amount if the caller did not supply one
          finalAmount     = finalAmount || linkedDocument.amount;
        }

        // Validate we have a reserve reference and amount to proceed
        if (!finalReserveRef || !finalAmount) {
          return res.status(400).json({
            error:    'Either documentId (with a registered document) or both reserveReference and amount are required',
            required: ['destinationAddress', 'documentId OR reserveReference', 'amount'],
          });
        }

        // ── Execute the mint via CIPRIssuance ────────────────────────────
        // This is Step 4 of the CIPR lifecycle: issuer → holder (trust line credited)
        const mintMemo    = memo ||
          `12 USC 411 — issued against trust reserve [${finalReserveRef}]; UCC 3-603 obligation created`;
        const mintReceipt = this.cipr.issue(
          destinationAddress,
          String(finalAmount),
          finalReserveRef,
          mintMemo
        );

        // ── Attach the mint receipt to the document record ───────────────
        // Creates the permanent on-record link between the document and its CIPR issuance
        if (documentId && linkedDocument) {
          this.documentService.attachMintReceipt(documentId, mintReceipt);
        }

        res.json({
          status:         'issued',
          step:           4,
          ...mintReceipt, // transactionType, account, destination, amount, reserveEntry
          linkedDocument: linkedDocument ? {
            documentId:   linkedDocument.documentId,
            documentType: linkedDocument.documentType,
            title:        linkedDocument.title,
            status:       linkedDocument.status,
          } : null,
          reserveHealth:  this.cipr.reserveStatus(),
        });

      } catch (err) {
        res.status(400).json({ error: 'Issue failed', detail: err.message });
      }
    });

    /**
     * POST /admin/cipr/burn
     *
     * Burn CIPR (Step 6 — Settlement) and optionally retire the linked document.
     *
     * If `documentId` is provided, the corresponding document record is
     * automatically retired in DocumentService after a successful burn.
     * This closes both ledgers simultaneously: the on-chain reserve is retired
     * AND the off-chain document record is marked as settled/discharged.
     *
     * Body: { holderAddress, amount, documentId?, memo? }
     */
    this.app.post('/admin/cipr/burn', trusteeAuth, (req, res) => {
      try {
        const { holderAddress, amount, documentId, memo } = req.body;
        if (!holderAddress || !amount) {
          return res.status(400).json({ error: 'holderAddress and amount are required' });
        }

        // Build the UCC discharge memo
        const burnMemo = memo ||
          'UCC 3-311 / UCC 3-603 — accord & satisfaction; obligation discharged; reserve offset recorded';

        // ── Execute the burn via CIPRIssuance (Step 6) ───────────────────
        // trust line debited, circulating supply decreased, reserve retired FIFO
        const burnReceipt = this.cipr.burn(holderAddress, String(amount), burnMemo);

        // ── Retire the linked document if provided ───────────────────────
        // This simultaneously closes the off-chain record, ensuring both the
        // reserve ledger and the document register reflect the settled state.
        let retiredDoc = null;
        if (documentId) {
          this.documentService.retireDocument(
            documentId,
            `${burnMemo} | Burned: ${amount} CIPR at ${new Date().toISOString()}`
          );
          retiredDoc = this.documentService.getDocument(documentId);
        }

        res.json({
          status:         'burned',
          step:           6,
          ...burnReceipt, // transactionType, account, destination, amount, newCirculatingSupply
          retiredDocument: retiredDoc ? {
            documentId:    retiredDoc.documentId,
            documentType:  retiredDoc.documentType,
            title:         retiredDoc.title,
            status:        retiredDoc.status,      // 'retired'
            retiredAt:     retiredDoc.retiredAt,
          } : null,
          reserveHealth:  this.cipr.reserveStatus(),
          legalNote:
            'Obligation discharged under UCC 3-311 (accord & satisfaction) and ' +
            'UCC 3-603 (tender of payment). Reserve offset recorded. Ledger balanced.',
        });

      } catch (err) {
        res.status(400).json({ error: 'Burn failed', detail: err.message });
      }
    });

    /**
     * POST /admin/cipr/freeze
     * Freeze or unfreeze an individual trust line.
     * Body: { holderAddress, action: 'freeze'|'unfreeze' }
     */
    this.app.post('/admin/cipr/freeze', trusteeAuth, (req, res) => {
      try {
        const { holderAddress, action } = req.body;
        if (!holderAddress || !['freeze', 'unfreeze'].includes(action)) {
          return res.status(400).json({
            error:   'holderAddress and action ("freeze" or "unfreeze") are required',
          });
        }
        const result = action === 'freeze'
          ? this.cipr.freezeTrustLine(holderAddress)
          : this.cipr.unfreezeTrustLine(holderAddress);
        const tl = this.cipr.getTrustLine(holderAddress);
        res.json({ status: 'success', ...result, trustLine: tl ? tl.toJSON() : null });
      } catch (err) {
        res.status(400).json({ error: 'Freeze operation failed', detail: err.message });
      }
    });

    /**
     * POST /admin/cipr/globalfreeze
     * Activate or clear the global freeze on all CIPR payments.
     * Body: { action: 'freeze'|'unfreeze' }
     */
    this.app.post('/admin/cipr/globalfreeze', trusteeAuth, (req, res) => {
      try {
        const { action } = req.body;
        if (!['freeze', 'unfreeze'].includes(action)) {
          return res.status(400).json({ error: 'action must be "freeze" or "unfreeze"' });
        }
        const result = action === 'freeze'
          ? this.cipr.setGlobalFreeze()
          : this.cipr.clearGlobalFreeze();
        res.json({ status: 'success', ...result, reserveHealth: this.cipr.reserveStatus() });
      } catch (err) {
        res.status(400).json({ error: 'Global freeze operation failed', detail: err.message });
      }
    });

    /**
     * GET /admin/cipr/reserve
     * Live reserve health: circulating supply, total reserved, ratio, entry count.
     */
    this.app.get('/admin/cipr/reserve', trusteeAuth, (req, res) => {
      res.json(this.cipr.reserveStatus());
    });

    /**
     * GET /admin/cipr/trustlines
     * All registered trust lines — the complete map of consent relationships.
     */
    this.app.get('/admin/cipr/trustlines', trusteeAuth, (req, res) => {
      const tls = this.cipr.allTrustLines();
      res.json({ count: tls.length, trustLines: tls });
    });

    /**
     * GET /admin/cipr/trustline/:address
     * Retrieve the full trust line state for a specific holder.
     */
    this.app.get('/admin/cipr/trustline/:address', trusteeAuth, (req, res) => {
      const tl = this.cipr.getTrustLine(req.params.address);
      if (!tl) {
        return res.status(404).json({
          error:   `No trust line found for ${req.params.address}`,
          hint:    'The holder must call TrustSet (Step 3) before a trust line exists',
        });
      }
      res.json(tl.toJSON());
    });

    // ═══════════════════════════════════════════════════════════════════════
    // DOCUMENTS — trust instrument record management (via DocumentService)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * POST /admin/document
     *
     * Enter a new trust instrument into the document register.
     * Returns a documentId to use as the reserveReference when minting CIPR.
     *
     * This is the first action before minting CIPR against any real-world
     * instrument:  document first, then mint.  Substance before circulation.
     *
     * Body: { documentType, title, amount, parties, currency?, dueDate?, memo? }
     */
    this.app.post('/admin/document', trusteeAuth, (req, res) => {
      // Delegate fully to DocumentService — attach the Trustee identity to the request
      // so DocumentService can record who entered the document.
      req.trustee = req.trustee; // already on req from trusteeAuth
      this.documentService.app._router.handle(
        Object.assign(req, { url: '/documents', method: 'POST' }),
        res,
        () => {}
      );
    });

    /**
     * GET /admin/documents
     * Full document register with optional ?status and ?type filters.
     */
    this.app.get('/admin/documents', trusteeAuth, (req, res) => {
      const { status, type } = req.query;
      const docs = this.documentService['_filterDocuments']({ status, type });
      res.json({
        total:     this.documentService['_documents'].size,
        filtered:  docs.length,
        filters:   { status: status || 'all', type: type || 'all' },
        documents: docs,
      });
    });

    /**
     * GET /admin/document/:id
     * Retrieve a specific document by ID.
     */
    this.app.get('/admin/document/:id', trusteeAuth, (req, res) => {
      const doc = this.documentService.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ error: `Document not found: ${req.params.id}` });
      }
      res.json(doc);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // BILL OF EXCHANGE — UCC-anchored negotiable instrument
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * POST /admin/bill-of-exchange
     *
     * Compose a formal bill of exchange under UCC Article 3.
     *
     * A bill of exchange is a written order from the drawer directing the
     * drawee to pay a specified amount to the payee on demand or at a
     * fixed date.  Under UCC 3-311 and UCC 3-603, this instrument establishes
     * the good-faith tender that discharges the underlying obligation.
     *
     * This endpoint does TWO things:
     *   1. Creates a DocumentService record of type 'bill-of-exchange'
     *      (gives the instrument a documentId / reserveReference)
     *   2. Builds the Transaction structure with uccTender set to '3-311' or
     *      '3-603' depending on the instrument's purpose, and returns
     *      dischargeEvidence() ready for presentation
     *
     * The caller can then:
     *   a. Use the documentId to mint CIPR via POST /admin/cipr/issue
     *   b. Present the billOfExchange.transactionStructure as the formal instrument
     *   c. Use billOfExchange.dischargeEvidence as the legal record of tender
     *
     * Body:
     *   drawer      — who is issuing the bill (defaults to Trustee's address)
     *   drawee      — who must accept and pay (address or name)
     *   payee       — who receives payment (address or name)
     *   amount      — face value of the bill (string for precision)
     *   currency    — 'CIPR' (default) or other
     *   dueDate     — optional maturity date (ISO string)
     *   uccTender   — '3-311' (accord & satisfaction) | '3-603' (tender of payment)
     *   memo        — instrument text / legal language
     */
    this.app.post('/admin/bill-of-exchange', trusteeAuth, (req, res) => {
      try {
        const {
          drawer    = req.trustee.sub,          // defaults to Trustee's cold wallet address
          drawee    = '',
          payee     = '',
          amount,
          currency  = 'CIPR',
          dueDate,
          uccTender = '3-311',                  // accord & satisfaction (most common)
          memo      = '',
        } = req.body;

        if (!amount) {
          return res.status(400).json({ error: 'amount is required' });
        }

        // ── Validate UCC tender type ─────────────────────────────────────────
        if (!['3-311', '3-603'].includes(uccTender)) {
          return res.status(400).json({
            error:       'uccTender must be "3-311" (accord & satisfaction) or "3-603" (tender of payment)',
            description: {
              '3-311': 'Payment satisfies an existing claim in full',
              '3-603': 'Good-faith presentment; refusal by payee discharges obligation',
            },
          });
        }

        // ── Step 1: Create the document record ───────────────────────────────
        // Generate the document ID that will serve as the reserveReference
        const typePrefix  = 'BOE'; // Bill Of Exchange
        const uniquePart  = crypto.randomBytes(12).toString('hex').toUpperCase();
        const documentId  = `DOC-${typePrefix}-${uniquePart}`;
        const now         = new Date().toISOString();

        // Build the UCC-anchored instrument text
        const instrumentText = memo ||
          `Bill of Exchange — ${drawer} orders ${drawee} to pay ${amount} ${currency} ` +
          `to ${payee || 'bearer'} on ${dueDate || 'demand'}. ` +
          `UCC ${uccTender === '3-311'
            ? '3-311 — Accord & Satisfaction: acceptance discharges obligation in full'
            : '3-603 — Tender of Payment: good-faith presentment; refusal discharges obligation'}.`;

        // Store the document record directly in DocumentService
        const document = {
          documentId,
          documentType:    'bill-of-exchange',
          title:           `Bill of Exchange — ${amount} ${currency} — ${drawer} → ${payee || drawee}`,
          amount:          String(amount),
          currency,
          parties:         { drawer, drawee, payee },
          dateIssued:      now,
          dueDate:         dueDate || null,
          legalAnchor:     `UCC ${uccTender} | 12 USC 411 | UCC 3-603`,
          memo:            instrumentText,
          status:          'active',
          ciprMintReceipt: null,
          retiredAt:       null,
          enteredBy:       req.trustee.sub,
          createdAt:       now,
          updatedAt:       now,
        };
        this.documentService['_documents'].set(documentId, document);
        this.documentService['_saveDocuments']();

        // ── Step 2: Build the Transaction structure ──────────────────────────
        // This mirrors a negotiable instrument's legal structure.
        // fromAddress = drawer (the party tendering)
        // toAddress   = drawee  (the party that must accept)
        // uccTender   = UCC section governing discharge
        //
        // Note: this Transaction is NOT submitted to the blockchain — it is the
        // formal instrument record.  To submit a blockchain transaction, the caller
        // must sign it and POST to /api/transactions.
        const txStructure = new Transaction(
          drawer,              // fromAddress — the drawer / tendering party
          drawee || payee,     // toAddress   — the drawee / accepting party
          { currency, issuer: this.cipr.issuerAddress, value: String(amount) },
          instrumentText,      // memo — the full instrument text
          {
            transactionType: 'Payment',
            uccTender,         // '3-311' or '3-603' — the governing UCC section
            flags:            0,
          }
        );

        // Generate the discharge evidence — the legal record of this tender
        const dischargeEvidence = txStructure.dischargeEvidence();

        res.status(201).json({
          status:            'composed',
          documentId,        // use this as reserveReference for minting CIPR
          document,          // full instrument record
          billOfExchange: {
            instrumentText,                      // the formal bill of exchange text
            transactionStructure: {              // the Transaction field layout
              fromAddress:     txStructure.fromAddress,
              toAddress:       txStructure.toAddress,
              amount:          txStructure.amount,
              memo:            txStructure.memo,
              uccTender:       txStructure.uccTender,
              transactionType: txStructure.transactionType,
              timestamp:       txStructure.timestamp,
            },
            dischargeEvidence,                   // UCC discharge record for legal presentation
          },
          nextSteps: {
            mintCIPR: {
              action: 'POST /admin/cipr/issue',
              body: {
                destinationAddress: payee || '<payee-address>',
                documentId,                       // links mint to this bill
                amount:             String(amount),
              },
            },
            submitToChain: {
              note:   'Sign the transactionStructure with the drawer\'s private key, then POST to /api/transactions',
              action: 'POST /api/transactions',
            },
          },
        });

      } catch (err) {
        res.status(500).json({ error: 'Failed to compose bill of exchange', detail: err.message });
      }
    });

    /**
     * GET /admin/discharge/:txHash
     *
     * Retrieve the UCC discharge evidence for a settled transaction.
     *
     * This endpoint reconstructs the discharge record from the transaction data
     * stored in the chain.  The evidence includes the transaction hash, timestamp,
     * parties, amount, and the applicable UCC anchor — providing a formal record
     * that the obligation was tendered and (if UCC 3-311) satisfied in full.
     *
     * If the transaction had uccTender set, the discharge evidence is returned.
     * If the transaction has no UCC anchor, the raw transaction data is returned.
     */
    this.app.get('/admin/discharge/:txHash', trusteeAuth, (req, res) => {
      const targetHash = req.params.txHash;

      // Search all settled blocks for a transaction with the matching hash
      for (const block of this.blockchain.chain) {
        for (const tx of block.transactions) {
          if (typeof tx.calculateHash === 'function' && tx.calculateHash() === targetHash) {
            const evidence = tx.dischargeEvidence();
            return res.json({
              found:            true,
              blockIndex:       this.blockchain.chain.indexOf(block),
              blockHash:        block.hash,
              transaction:      tx,
              dischargeEvidence: evidence ||
                { note: 'This transaction has no UCC tender anchor — no discharge evidence generated' },
            });
          }
        }
      }

      res.status(404).json({
        found:   false,
        error:   `Transaction hash not found in settled chain: ${targetHash}`,
        hint:    'Ensure the transaction has been mined into a block before querying discharge evidence',
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TRUSTEE MEMBER ROLL — core member registration
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * POST /admin/members
     *
     * Register a core member of the Trust — a Trustee, Co-Trustee, or Beneficiary.
     *
     * The member roll records who holds what role in the Trust structure.
     * Each member is identified by their blockchain address (public key) and
     * registered with a name, role, and optional notes.
     *
     * Roles:
     *   trustee       — primary authority holder; controls the cold wallet
     *   co-trustee    — secondary authority; shares administrative duties
     *   beneficiary   — holds an interest in the Trust; may receive distributions
     *   protector     — oversees the Trustee's actions; cannot administer
     *   observer      — read-only access; no administrative authority
     *
     * Body: { address, name, role, notes? }
     */
    this.app.post('/admin/members', trusteeAuth, (req, res) => {
      try {
        const { address, name, role, notes = '' } = req.body;

        const VALID_ROLES = ['trustee', 'co-trustee', 'beneficiary', 'protector', 'observer'];

        if (!address || !name || !role) {
          return res.status(400).json({
            error:    'address, name, and role are required',
            validRoles: VALID_ROLES,
          });
        }

        if (!VALID_ROLES.includes(role)) {
          return res.status(400).json({
            error:      `Invalid role: ${role}`,
            validRoles: VALID_ROLES,
          });
        }

        const now    = new Date().toISOString();
        const member = {
          address,                          // blockchain address / public key
          name,                             // member's name or identifier
          role,                             // trust role
          notes,                            // additional context
          registeredBy: req.trustee.sub,   // who registered this member
          createdAt:    now,
          updatedAt:    now,
        };

        // Store in member roll — address is the unique key
        this._members.set(address, member);

        res.status(201).json({
          status: 'registered',
          member,
          roll:   { count: this._members.size },
        });

      } catch (err) {
        res.status(500).json({ error: 'Failed to register member', detail: err.message });
      }
    });

    /**
     * GET /admin/members
     * Return the full Trustee member roll — all registered core members.
     */
    this.app.get('/admin/members', trusteeAuth, (req, res) => {
      const members = Array.from(this._members.values());
      res.json({
        count:   members.length,
        members,
      });
    });

    /**
     * GET /admin/members/:address
     * Retrieve a specific member by their blockchain address.
     */
    this.app.get('/admin/members/:address', trusteeAuth, (req, res) => {
      const member = this._members.get(req.params.address);
      if (!member) {
        return res.status(404).json({ error: `Member not found: ${req.params.address}` });
      }
      res.json(member);
    });
  }
}

module.exports = AdminGateway;
