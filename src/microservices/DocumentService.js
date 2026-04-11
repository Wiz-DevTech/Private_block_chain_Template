/**
 * DocumentService — the Trust's formal record-keeping layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * In the CIPR framework, the `reserveReference` field on every `issue()` call
 * is the bridge between the on-chain token and the real-world substance backing
 * it.  In the base system that reference is a plain string — functional but
 * unstructured.
 *
 * DocumentService gives that reference formal structure.  Every time the
 * Trustee enters a bill of exchange, a trust bond, an indemnity agreement, or
 * any other instrument, DocumentService creates a structured record and returns
 * a unique `documentId`.  That ID is then used as the `reserveReference` when
 * minting CIPR, creating a verifiable link between:
 *
 *   documentId  ←→  reserveReference  ←→  CIPR tokens in circulation
 *
 * When those tokens are burned (Step 6 — Settlement), the linked document is
 * retired — the record closes alongside the obligation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOCUMENT TYPES
 * ─────────────────────────────────────────────────────────────────────────────
 *   bill-of-exchange   — A written order to pay a specific amount on a specific
 *                        date.  UCC Article 3 governs negotiable instruments.
 *                        Governed by UCC 3-311 (accord & satisfaction) and
 *                        UCC 3-603 (tender of payment).
 *
 *   trust-bond         — A bond issued under trust authority, backed by the
 *                        trust corpus.  The CIPR framework treats the trust
 *                        corpus as the real reserve — unlike Treasury bonds
 *                        backed only by future tax extraction.
 *
 *   indemnity          — A document whereby one party agrees to compensate
 *                        another for losses arising from a specific event.
 *                        Creates a quantifiable obligation that can be backed
 *                        by CIPR issuance.
 *
 *   reserve-pledge     — A formal pledge of a specific asset or resource as
 *                        reserve backing for a CIPR issuance.  The most direct
 *                        form of 1:1 substantive backing.
 *
 *   promissory-note    — An unconditional written promise to pay a specified
 *                        sum to a named payee on demand or at a fixed date.
 *                        Governed by UCC Article 3.
 *
 *   court-order        — A formal court order creating a quantifiable obligation
 *                        or right — providing a documented basis for issuance.
 *
 *   trust-instrument   — The foundational governing document of a trust —
 *                        the declaration, deed, or indenture that establishes
 *                        the trust corpus and the Trustee's authority.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOCUMENT RECORD SCHEMA
 * ─────────────────────────────────────────────────────────────────────────────
 *   documentId        — Unique ID (UUID-style hex) used as reserveReference
 *   documentType      — One of the types listed above
 *   title             — Human-readable description of the document
 *   amount            — The value this document represents
 *   currency          — Currency of the amount (default: 'CIPR')
 *   parties           — { drawer, drawee, payee } — parties to the instrument
 *   dateIssued        — ISO timestamp of document creation
 *   dueDate           — Optional maturity or due date (ISO string)
 *   legalAnchor       — UCC / statutory references governing this document
 *   memo              — Additional context or legal text
 *   status            — 'active' | 'retired'
 *   ciprMintReceipt   — Populated when CIPR is minted against this document
 *   retiredAt         — ISO timestamp when the document was retired (settled)
 *   createdAt         — ISO timestamp
 *   updatedAt         — ISO timestamp
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERSISTENCE
 * ─────────────────────────────────────────────────────────────────────────────
 * Documents are stored in-memory and persisted to /data/documents.json on
 * every write operation.  On startup the file is loaded if it exists, so
 * documents survive node restarts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALL ROUTES REQUIRE TRUSTEE JWT
 * ─────────────────────────────────────────────────────────────────────────────
 * Document entry is a Trustee-only action — only the holder of the cold wallet
 * credential may create, modify, or retire records.  The trusteeAuth middleware
 * is applied to every route in this service.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENDPOINTS
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET    /documents                    — List all documents (optionally filter by status/type)
 *   POST   /documents                    — Enter a new document record
 *   GET    /documents/types              — List valid document types with descriptions
 *   GET    /documents/status/active      — All active (unredeemed) records
 *   GET    /documents/status/retired     — All settled/discharged records
 *   GET    /documents/:id                — Retrieve a specific document by ID
 *   PATCH  /documents/:id/retire         — Retire a document (mark as settled)
 *   PATCH  /documents/:id/mint-receipt   — Attach a CIPR mint receipt to a document
 */

'use strict';

const express    = require('express');
const bodyParser = require('body-parser');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const { trusteeAuth } = require('../middleware/trusteeAuth');
const config     = require('../config');

// ── Persistence file path ──────────────────────────────────────────────────────
// Documents are stored alongside the chain and genesis data in /data/
const DATA_DIR       = path.join(__dirname, '..', '..', 'data');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');

// ── Valid document types with their descriptions ──────────────────────────────
const DOCUMENT_TYPES = {
  'bill-of-exchange':  'Written order to pay a specific amount — governed by UCC Art. 3',
  'trust-bond':        'Bond issued under trust authority, backed by the trust corpus',
  'indemnity':         'Agreement to compensate for losses — creates quantifiable obligation',
  'reserve-pledge':    'Formal pledge of an asset as 1:1 reserve backing for CIPR issuance',
  'promissory-note':   'Unconditional written promise to pay — governed by UCC Art. 3',
  'court-order':       'Court-issued order creating a quantifiable obligation or right',
  'trust-instrument':  'Declaration, deed, or indenture establishing trust corpus and authority',
};

// ── Default legal anchor applied to all documents ────────────────────────────
const DEFAULT_LEGAL_ANCHOR = '12 USC 411 | UCC 3-311 | UCC 3-603';

class DocumentService {
  /**
   * Construct the DocumentService.
   *
   * On construction:
   *   1. The document store is loaded from /data/documents.json (if it exists)
   *      or initialised as an empty Map.
   *   2. Express app is created with JSON body parsing.
   *   3. All routes are registered, all protected by trusteeAuth middleware.
   *
   * @param {object} [options]
   * @param {boolean} [options.standalone=false] — when true, the service boots
   *        independently without injected blockchain/contractManager references.
   */
  constructor(options = {}) {
    this.app = express();
    this.app.use(bodyParser.json());

    // ── Document store: Map<documentId, document> ─────────────────────────────
    // Keyed by documentId.  Loaded from disk on startup; persisted on every write.
    this._documents = new Map();

    // Load any previously persisted documents
    this._loadDocuments();

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
      console.log(`[DocumentService] Trust Document Record Keeper → http://localhost:${port}`);
      console.log(`[DocumentService] Enter record               → POST http://localhost:${port}/documents`);
      console.log(`[DocumentService] List all records           → GET  http://localhost:${port}/documents`);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  _registerRoutes() {

    // ── Service index ─────────────────────────────────────────────────────────
    this.app.get('/', (req, res) => {
      res.json({
        service:  'CipherNex DocumentService — Trust Record Keeper',
        version:  '1.0.0',
        note:     'All routes require Trustee JWT — authenticate via AuthService first',
        endpoints: {
          'GET    /documents':                   'List all documents (query: ?status=active|retired&type=bill-of-exchange)',
          'POST   /documents':                   'Enter a new document record — returns documentId for use as reserveReference',
          'GET    /documents/types':             'Valid document types with legal descriptions',
          'GET    /documents/status/active':     'All active (unredeemed) records',
          'GET    /documents/status/retired':    'All settled/discharged records',
          'GET    /documents/:id':               'Retrieve a specific document by ID',
          'PATCH  /documents/:id/retire':        'Retire a document (mark as settled/discharged)',
          'PATCH  /documents/:id/mint-receipt':  'Attach a CIPR mint receipt to a document',
        },
      });
    });

    // ── GET /documents/types ──────────────────────────────────────────────────
    //
    // Returns the list of valid document types with their legal descriptions.
    // Used by the Trustee dashboard to populate a dropdown or type selector
    // when creating a new document record.
    //
    // NOTE: this route must be registered BEFORE /documents/:id so Express
    // does not interpret 'types' as a document ID.
    this.app.get('/documents/types', trusteeAuth, (req, res) => {
      res.json({
        documentTypes:   DOCUMENT_TYPES,
        defaultAnchor:   DEFAULT_LEGAL_ANCHOR,
        description:
          'Select the type that best describes the instrument being entered. ' +
          'The documentId returned by POST /documents should be used as the ' +
          'reserveReference when minting CIPR via AdminGateway.',
      });
    });

    // ── GET /documents/status/active ──────────────────────────────────────────
    //
    // Returns all documents with status 'active' — meaning CIPR has been (or
    // could be) minted against them but they have not yet been retired.
    // An active document represents an outstanding obligation or live backing.
    this.app.get('/documents/status/active', trusteeAuth, (req, res) => {
      const active = this._filterDocuments({ status: 'active' });
      res.json({
        count:     active.length,
        documents: active,
        note:      'Active documents are those with outstanding CIPR backing — not yet settled',
      });
    });

    // ── GET /documents/status/retired ─────────────────────────────────────────
    //
    // Returns all documents with status 'retired' — meaning the corresponding
    // CIPR was burned (Step 6 — Settlement), the reserve entry was retired,
    // and the obligation was discharged under UCC 3-311/3-603.
    // A retired document is the closed/settled record.
    this.app.get('/documents/status/retired', trusteeAuth, (req, res) => {
      const retired = this._filterDocuments({ status: 'retired' });
      res.json({
        count:     retired.length,
        documents: retired,
        note:      'Retired documents are settled records — obligation discharged, reserve offset',
      });
    });

    // ── GET /documents ────────────────────────────────────────────────────────
    //
    // List all documents with optional filtering.
    // Query parameters:
    //   ?status=active|retired       — filter by status
    //   ?type=bill-of-exchange|...   — filter by document type
    this.app.get('/documents', trusteeAuth, (req, res) => {
      const { status, type } = req.query;
      const docs = this._filterDocuments({ status, type });
      res.json({
        total:     this._documents.size,
        filtered:  docs.length,
        filters:   { status: status || 'all', type: type || 'all' },
        documents: docs,
      });
    });

    // ── POST /documents ───────────────────────────────────────────────────────
    //
    // Enter a new document record into the Trust's record register.
    //
    // This is the primary action of a Trustee as record keeper.  When the Trust
    // enters a bill of exchange, a bond, or an indemnity, this endpoint creates
    // the structured record and returns a `documentId`.
    //
    // WORKFLOW:
    //   1. Trustee enters a document here → receives documentId
    //   2. Trustee uses documentId as `reserveReference` in POST /admin/cipr/issue
    //   3. CIPR is minted against that document (Step 4)
    //   4. When CIPR is burned (Step 6), PATCH /documents/:id/retire is called
    //
    // Required body fields:
    //   documentType  — one of DOCUMENT_TYPES keys
    //   title         — description of the document
    //   amount        — value the document represents (string for precision)
    //   parties       — { drawer, drawee, payee }
    //
    // Optional fields:
    //   currency, dateIssued, dueDate, legalAnchor, memo
    this.app.post('/documents', trusteeAuth, (req, res) => {
      try {
        const {
          documentType,
          title,
          amount,
          currency    = 'CIPR',
          parties     = {},
          dateIssued,
          dueDate,
          legalAnchor = DEFAULT_LEGAL_ANCHOR,
          memo        = '',
        } = req.body;

        // ── Validate required fields ────────────────────────────────────────
        if (!documentType || !title || !amount || !parties) {
          return res.status(400).json({
            error:    'Missing required fields',
            required: ['documentType', 'title', 'amount', 'parties'],
            parties_required: ['drawer', 'drawee', 'payee'],
          });
        }

        // ── Validate document type ──────────────────────────────────────────
        if (!DOCUMENT_TYPES[documentType]) {
          return res.status(400).json({
            error:         'Invalid documentType',
            validTypes:    Object.keys(DOCUMENT_TYPES),
            hint:          'Call GET /documents/types for descriptions of each type',
          });
        }

        // ── Generate unique document ID ─────────────────────────────────────
        // The documentId IS the reserveReference used in ciprIssuance.issue().
        // Format: DOC-<type prefix>-<16-byte hex> for traceability
        const typePrefix   = documentType.split('-').map(w => w[0].toUpperCase()).join('');
        const uniquePart   = crypto.randomBytes(12).toString('hex').toUpperCase();
        const documentId   = `DOC-${typePrefix}-${uniquePart}`;

        const now          = new Date().toISOString();

        // ── Construct the document record ───────────────────────────────────
        const document = {
          documentId,                                 // use as reserveReference
          documentType,                               // instrument type
          title,                                      // human-readable description
          amount:          String(amount),            // value (string for precision)
          currency,                                   // 'CIPR' or other
          parties: {
            drawer:  parties.drawer  || req.trustee.sub, // defaults to Trustee
            drawee:  parties.drawee  || '',
            payee:   parties.payee   || '',
          },
          dateIssued:      dateIssued  || now,        // document date
          dueDate:         dueDate     || null,       // maturity/due date if applicable
          legalAnchor,                                // UCC/statutory references
          memo,                                       // additional text
          status:          'active',                  // active until retired
          ciprMintReceipt: null,                      // populated when CIPR is issued
          retiredAt:       null,                      // populated when settled
          enteredBy:       req.trustee.sub,           // Trustee who created this record
          createdAt:       now,
          updatedAt:       now,
        };

        // ── Store and persist ───────────────────────────────────────────────
        this._documents.set(documentId, document);
        this._saveDocuments();

        res.status(201).json({
          status:      'created',
          documentId,  // ← use this as reserveReference in POST /admin/cipr/issue
          document,
          nextStep: {
            action:  'POST /admin/cipr/issue',
            note:    'Use documentId as the reserveReference to mint CIPR against this document',
            body: {
              destinationAddress: '<holder-address-with-trust-line>',
              amount:             String(amount),
              reserveReference:   documentId,          // the link
              memo:               `${legalAnchor} — ${title}`,
            },
          },
        });

      } catch (err) {
        res.status(500).json({ error: 'Failed to create document', detail: err.message });
      }
    });

    // ── GET /documents/:id ────────────────────────────────────────────────────
    //
    // Retrieve a specific document by its documentId.
    // Used by AdminGateway to validate that a document exists before minting
    // CIPR against it, and by the Trustee dashboard to inspect a record.
    this.app.get('/documents/:id', trusteeAuth, (req, res) => {
      const doc = this._documents.get(req.params.id);
      if (!doc) {
        return res.status(404).json({
          error:  `Document not found: ${req.params.id}`,
          hint:   'Call GET /documents to see all registered document IDs',
        });
      }
      res.json(doc);
    });

    // ── PATCH /documents/:id/retire ───────────────────────────────────────────
    //
    // Retire a document — mark it as settled/discharged.
    //
    // This is called AFTER the corresponding CIPR has been burned (Step 6).
    // The `retiredAt` timestamp and an optional `settlementMemo` are recorded,
    // and the status changes from 'active' to 'retired'.
    //
    // The document cannot be retired again (idempotent guard).
    //
    // The flow that triggers retirement:
    //   POST /admin/cipr/burn  → ciprIssuance.burn() retires reserve entries
    //   Then: PATCH /documents/:id/retire  → DocumentService marks the record closed
    //
    // Optional body:
    //   settlementMemo — UCC discharge language or other context
    this.app.patch('/documents/:id/retire', trusteeAuth, (req, res) => {
      try {
        const doc = this._documents.get(req.params.id);
        if (!doc) {
          return res.status(404).json({ error: `Document not found: ${req.params.id}` });
        }

        // Guard: already retired — do not double-retire
        if (doc.status === 'retired') {
          return res.status(409).json({
            error:      'Document is already retired',
            retiredAt:  doc.retiredAt,
          });
        }

        const { settlementMemo = '' } = req.body;
        const now = new Date().toISOString();

        // Update the document record to reflect discharge
        doc.status          = 'retired';
        doc.retiredAt       = now;
        doc.updatedAt       = now;
        doc.settlementMemo  = settlementMemo ||
          `Obligation discharged — UCC 3-311 accord & satisfaction; UCC 3-603 tender accepted. ${now}`;
        doc.retiredBy       = req.trustee.sub; // Trustee who closed the record

        this._saveDocuments();

        res.json({
          status:   'retired',
          document: doc,
          note:     'This record is now closed — the obligation has been discharged',
        });

      } catch (err) {
        res.status(500).json({ error: 'Failed to retire document', detail: err.message });
      }
    });

    // ── PATCH /documents/:id/mint-receipt ─────────────────────────────────────
    //
    // Attach the CIPR mint receipt to a document after AdminGateway mints CIPR
    // against it.  This creates the on-record link between the document and
    // its corresponding CIPR issuance.
    //
    // This is called internally by AdminGateway after a successful issue(),
    // but can also be called manually if the link was not established at mint time.
    //
    // Body:
    //   mintReceipt — the receipt object returned by ciprIssuance.issue()
    this.app.patch('/documents/:id/mint-receipt', trusteeAuth, (req, res) => {
      try {
        const doc = this._documents.get(req.params.id);
        if (!doc) {
          return res.status(404).json({ error: `Document not found: ${req.params.id}` });
        }

        const { mintReceipt } = req.body;
        if (!mintReceipt) {
          return res.status(400).json({ error: 'mintReceipt is required in request body' });
        }

        // Attach the mint receipt — creates the on-record CIPR issuance link
        doc.ciprMintReceipt = mintReceipt;
        doc.updatedAt       = new Date().toISOString();

        this._saveDocuments();

        res.json({
          status:   'updated',
          document: doc,
          note:     'CIPR mint receipt attached — document is now linked to its on-chain issuance',
        });

      } catch (err) {
        res.status(500).json({ error: 'Failed to attach mint receipt', detail: err.message });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC ACCESSORS — used by AdminGateway without going through HTTP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Look up a document by ID directly (in-process call from AdminGateway).
   * Returns null if not found.
   *
   * @param {string} documentId
   * @returns {object|null}
   */
  getDocument(documentId) {
    return this._documents.get(documentId) || null;
  }

  /**
   * Attach a CIPR mint receipt to a document (in-process call from AdminGateway).
   * Called immediately after AdminGateway successfully calls ciprIssuance.issue().
   *
   * @param {string} documentId
   * @param {object} mintReceipt — receipt from ciprIssuance.issue()
   */
  attachMintReceipt(documentId, mintReceipt) {
    const doc = this._documents.get(documentId);
    if (doc) {
      doc.ciprMintReceipt = mintReceipt;
      doc.updatedAt       = new Date().toISOString();
      this._saveDocuments();
    }
  }

  /**
   * Retire a document by ID (in-process call from AdminGateway after burn).
   *
   * @param {string} documentId
   * @param {string} [settlementMemo]
   */
  retireDocument(documentId, settlementMemo = '') {
    const doc = this._documents.get(documentId);
    if (doc && doc.status !== 'retired') {
      const now           = new Date().toISOString();
      doc.status          = 'retired';
      doc.retiredAt       = now;
      doc.updatedAt       = now;
      doc.settlementMemo  = settlementMemo ||
        `Obligation discharged — UCC 3-311/3-603 — ${now}`;
      this._saveDocuments();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS — persistence and filtering
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Filter documents by optional status and/or type criteria.
   * Returns an array of matching document objects (sorted newest first).
   *
   * @param {object} filters
   * @param {string} [filters.status] — 'active' | 'retired'
   * @param {string} [filters.type]   — one of DOCUMENT_TYPES keys
   * @returns {Array}
   */
  _filterDocuments({ status, type } = {}) {
    return Array.from(this._documents.values())
      .filter(doc => {
        if (status && doc.status !== status)           return false;
        if (type   && doc.documentType !== type)       return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first
  }

  /**
   * Load the document store from /data/documents.json on startup.
   * If the file does not exist (first run), the store starts empty.
   * Errors during load are logged but do not crash the service.
   */
  _loadDocuments() {
    try {
      if (!fs.existsSync(DOCUMENTS_FILE)) return; // first run — no file yet
      const raw  = fs.readFileSync(DOCUMENTS_FILE, 'utf8');
      const docs = JSON.parse(raw);
      // Restore the Map from the flat array stored in the JSON file
      if (Array.isArray(docs)) {
        docs.forEach(doc => this._documents.set(doc.documentId, doc));
        console.log(`[DocumentService] Loaded ${this._documents.size} documents from ${DOCUMENTS_FILE}`);
      }
    } catch (err) {
      console.error(`[DocumentService] Failed to load documents: ${err.message}`);
    }
  }

  /**
   * Persist the current document store to /data/documents.json.
   * Called after every create, retire, or update operation.
   * The file stores a flat JSON array — the Map is serialised for portability.
   */
  _saveDocuments() {
    try {
      // Ensure the /data directory exists (mirrors Storage.js pattern)
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      // Serialise Map values as a flat array for JSON storage
      const docs = Array.from(this._documents.values());
      fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2));
    } catch (err) {
      console.error(`[DocumentService] Failed to save documents: ${err.message}`);
    }
  }
}

module.exports = DocumentService;
