'use strict';

/**
 * ProtocolService — CipherNex lifecycle microservice.
 *
 * Exposes the full six-step CIPR lifecycle as a dedicated REST API:
 *
 *   Step 1 — Genesis    GET  /protocol/genesis
 *   Step 2 — Account    POST /protocol/account
 *   Step 3 — TrustSet   POST /protocol/trustset
 *   Step 4 — Issue      POST /protocol/issue
 *   Step 5 — Transfer   POST /protocol/transfer
 *   Step 6 — Settle     POST /protocol/settle
 *
 * Support routes:
 *   GET  /protocol/reserve              Reserve status & supply metrics
 *   GET  /protocol/balance/:address     Trust line balance
 *   GET  /protocol/trustlines           All registered trust lines
 *   POST /protocol/run                  Full automated lifecycle demo
 *   GET  /                              Service index
 *
 * Ports: default 3002 (set PROTOCOL_PORT env var to override)
 */

const express    = require('express');
const bodyParser = require('body-parser');
const crypto     = require('crypto');
const { bufferToHex, privateToAddress } = require('ethereumjs-util');

class ProtocolService {
  /**
   * @param {import('../blockchain/Blockchain')} blockchain
   * @param {import('../blockchain/ContractManager')} contractManager
   */
  constructor(blockchain, contractManager) {
    this.blockchain = blockchain;
    this.cipr       = contractManager.ciprIssuance;

    this.app = express();
    this.app.use(bodyParser.json());
    this._registerRoutes();
  }

  // ---------------------------------------------------------------------------
  // Public API — start the service
  // ---------------------------------------------------------------------------

  start(port) {
    this.app.listen(port, () => {
      console.log(`[ProtocolService] CipherNex Protocol Microservice → http://localhost:${port}`);
      console.log(`[ProtocolService] Full lifecycle demo            → POST http://localhost:${port}/protocol/run`);
      console.log(`[ProtocolService] Interactive docs               → GET  http://localhost:${port}/`);
    });
  }

  // ---------------------------------------------------------------------------
  // Route registration
  // ---------------------------------------------------------------------------

  _registerRoutes() {

    // ------------------------------------------------------------------
    // Service index — lists every endpoint with sample payloads
    // ------------------------------------------------------------------
    this.app.get('/', (req, res) => {
      res.json({
        service:  'CipherNex Protocol Microservice',
        version:  '1.0.0',
        network:  this.blockchain.networkName,
        chainId:  this.blockchain.chainId,
        currency: this.cipr.currency,
        issuer:   this.cipr.issuerAddress,
        hotWallet: this.cipr.hotWalletAddress,
        endpoints: {
          'GET  /protocol/genesis':            'Step 1 — Genesis reserve status (set at startup)',
          'POST /protocol/account':            'Step 2 — Create wallet (no trust line yet)',
          'POST /protocol/trustset':           'Step 3 — Establish CIPR trust line',
          'POST /protocol/issue':              'Step 4 — Mint CIPR (1:1 backed by reserveReference)',
          'POST /protocol/transfer':           'Step 5 — Holder-to-holder payment',
          'POST /protocol/settle':             'Step 6 — Burn + retire reserve (UCC 3-311/3-603)',
          'GET  /protocol/reserve':            'Reserve status & circulating supply',
          'GET  /protocol/balance/:address':   'Trust line balance for a holder',
          'GET  /protocol/trustlines':         'All registered trust lines',
          'POST /protocol/run':                'Automated full lifecycle demo (Genesis → Settlement)',
        },
      });
    });

    // ------------------------------------------------------------------
    // Step 1 — Genesis
    // ------------------------------------------------------------------
    this.app.get('/protocol/genesis', (req, res) => {
      const status = this.cipr.reserveStatus();
      res.json({
        step:        1,
        name:        'Genesis',
        description: 'ContractManager minted genesis CIPR to the hot wallet at node startup',
        legalAnchor: '12 USC 411 — genesis reserve allocation; UCC 3-603 tender established',
        reserveReference: 'GENESIS-RESERVE-001',
        issuer:      this.cipr.issuerAddress,
        hotWallet:   this.cipr.hotWalletAddress,
        reserve:     status,
        next: {
          step:   2,
          action: 'POST /protocol/account',
          body:   {},
        },
      });
    });

    // ------------------------------------------------------------------
    // Step 2 — Account creation
    // ------------------------------------------------------------------
    this.app.post('/protocol/account', (req, res) => {
      const wallet = this._createWallet();
      res.json({
        step:        2,
        name:        'Account',
        status:      'success',
        description: 'Wallet created — it cannot hold CIPR until a trust line is established',
        wallet,
        next: {
          step:   3,
          action: 'POST /protocol/trustset',
          body:   { holderAddress: wallet.address, limit: '100000000000' },
          curl: [
            `curl -X POST http://localhost:${this._port}/protocol/trustset \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{ "holderAddress": "${wallet.address}", "limit": "100000000000" }'`,
          ].join('\n'),
        },
      });
    });

    // ------------------------------------------------------------------
    // Step 3 — TrustSet
    // ------------------------------------------------------------------
    this.app.post('/protocol/trustset', (req, res) => {
      try {
        const { holderAddress, limit } = req.body;
        if (!holderAddress) throw new Error('holderAddress is required');

        const tl = this.cipr.trustSet(holderAddress, limit);
        res.json({
          step:        3,
          name:        'TrustSet',
          status:      'success',
          description: 'Trust line established — holder may now receive CIPR from the issuer',
          legalAnchor: 'AccountSet asfDefaultRipple — trust line opened toward cold wallet issuer',
          transactionType: 'TrustSet',
          trustLine:   tl.toJSON(),
          next: {
            step:   4,
            action: 'POST /protocol/issue',
            body: {
              destinationAddress: holderAddress,
              amount:            '1000',
              reserveReference:  'RESERVE-DOC-2026-001',
              memo:              '12 USC 411 — issued against trust reserve',
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

    // ------------------------------------------------------------------
    // Step 4 — Issue (mint)
    // ------------------------------------------------------------------
    this.app.post('/protocol/issue', (req, res) => {
      try {
        const { destinationAddress, amount, reserveReference, memo } = req.body;
        if (!destinationAddress || !amount || !reserveReference) {
          throw new Error('destinationAddress, amount, and reserveReference are required');
        }

        const receipt = this.cipr.issue(destinationAddress, String(amount), reserveReference, memo);
        const tl      = this.cipr.getTrustLine(destinationAddress);

        res.json({
          step:        4,
          name:        'Issue',
          status:      'success',
          description: 'CIPR minted to holder; reserve entry created 1:1',
          legalAnchor: '12 USC 411 — issued against assets held in trust; UCC 3-603 obligation created',
          ...receipt,
          trustLineBalance: tl ? tl.balance : null,
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

    // ------------------------------------------------------------------
    // Step 5 — Transfer
    // ------------------------------------------------------------------
    this.app.post('/protocol/transfer', (req, res) => {
      try {
        const { fromAddress, toAddress, amount, memo } = req.body;
        if (!fromAddress || !toAddress || !amount) {
          throw new Error('fromAddress, toAddress, and amount are required');
        }

        const receipt = this.cipr.transfer(fromAddress, toAddress, String(amount), memo);
        const fromTl  = this.cipr.getTrustLine(fromAddress);
        const toTl    = this.cipr.getTrustLine(toAddress);

        res.json({
          step:        5,
          name:        'Transfer',
          status:      'success',
          description: 'CIPR transferred between holders; both trust lines updated',
          legalAnchor: 'UCC 3-603 — payment tendered between holders',
          ...receipt,
          postTransferBalances: {
            [fromAddress]: fromTl ? fromTl.balance : null,
            [toAddress]:   toTl   ? toTl.balance   : null,
          },
          next: {
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

    // ------------------------------------------------------------------
    // Step 6 — Settle (burn)
    // ------------------------------------------------------------------
    this.app.post('/protocol/settle', (req, res) => {
      try {
        const { holderAddress, amount, memo } = req.body;
        if (!holderAddress || !amount) {
          throw new Error('holderAddress and amount are required');
        }

        const receipt = this.cipr.burn(
          holderAddress,
          String(amount),
          memo || 'UCC 3-311 / UCC 3-603 — accord & satisfaction; obligation discharged'
        );
        const reserve = this.cipr.reserveStatus();

        res.json({
          step:        6,
          name:        'Settlement',
          status:      'success',
          description: 'CIPR burned; reserve retired FIFO; obligation discharged under UCC 3-311/3-603',
          legalAnchor: 'UCC 3-311 / UCC 3-603 — tender accepted; reserve offset recorded',
          ...receipt,
          postSettlementReserve: {
            circulatingSupply: reserve.circulatingSupply,
            totalReserved:     reserve.totalReserved,
            reserveRatio:      reserve.reserveRatio,
            remainingEntries:  reserve.reserveEntries,
          },
        });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // ------------------------------------------------------------------
    // Support routes
    // ------------------------------------------------------------------

    this.app.get('/protocol/reserve', (req, res) => {
      res.json(this.cipr.reserveStatus());
    });

    this.app.get('/protocol/balance/:address', (req, res) => {
      const tl = this.cipr.getTrustLine(req.params.address);
      if (!tl) return res.status(404).json({ error: 'No trust line found for this address' });
      res.json({
        address:  req.params.address,
        currency: tl.currency,
        balance:  tl.balance,
        limit:    tl.limit,
        frozen:   tl.frozen,
      });
    });

    this.app.get('/protocol/trustlines', (req, res) => {
      res.json({ trustLines: this.cipr.allTrustLines() });
    });

    // ------------------------------------------------------------------
    // POST /protocol/run — automated end-to-end lifecycle demo
    // ------------------------------------------------------------------
    this.app.post('/protocol/run', (req, res) => {
      try {
        res.json(this._runLifecycle());
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle runner — orchestrates all six steps programmatically
  // ---------------------------------------------------------------------------

  _runLifecycle() {
    const executedAt = new Date().toISOString();
    const steps      = [];

    // ── Step 1 — Genesis (already established at node startup) ──────────────
    const genesisReserve = this.cipr.reserveStatus();
    steps.push({
      step:        1,
      name:        'Genesis',
      description: 'ContractManager minted 100B CIPR to the hot wallet at startup, backed by GENESIS-RESERVE-001',
      issuer:      this.cipr.issuerAddress,
      hotWallet:   this.cipr.hotWalletAddress,
      circulatingSupply: genesisReserve.circulatingSupply,
      reserveEntries:    genesisReserve.reserveEntries,
    });

    // ── Step 2 — Create two holder wallets ──────────────────────────────────
    const holder1 = this._createWallet();
    const holder2 = this._createWallet();
    steps.push({
      step:        2,
      name:        'Account',
      description: 'Two holder wallets created; neither can hold CIPR until trust lines are established',
      holder1: { address: holder1.address },
      holder2: { address: holder2.address },
    });

    // ── Step 3 — TrustSet for both holders ──────────────────────────────────
    const tl1 = this.cipr.trustSet(holder1.address, '100000000000');
    const tl2 = this.cipr.trustSet(holder2.address, '100000000000');
    steps.push({
      step:        3,
      name:        'TrustSet',
      description: 'Both holders established trust lines toward the CIPR cold wallet issuer',
      legalAnchor: 'AccountSet asfDefaultRipple',
      holder1TrustLine: tl1.toJSON(),
      holder2TrustLine: tl2.toJSON(),
    });

    // ── Step 4 — Issue 10,000 CIPR to holder1 ───────────────────────────────
    const reserveRef   = `RESERVE-LIFECYCLE-${Date.now()}`;
    const issueReceipt = this.cipr.issue(
      holder1.address,
      '10000',
      reserveRef,
      `12 USC 411 — lifecycle demo issuance; ${executedAt}`
    );
    steps.push({
      step:        4,
      name:        'Issue',
      description: 'Issuer minted 10,000 CIPR to holder1, backed by a new reserve entry',
      legalAnchor: '12 USC 411 — issued against trust reserve; obligation created',
      reserveReference: reserveRef,
      ...issueReceipt,
      holder1Balance: this.cipr.getTrustLine(holder1.address).balance,
    });

    // ── Step 5 — Transfer 5,000 CIPR: holder1 → holder2 ────────────────────
    const transferReceipt = this.cipr.transfer(
      holder1.address,
      holder2.address,
      '5000',
      'Lifecycle demo: holder-to-holder payment'
    );
    steps.push({
      step:        5,
      name:        'Transfer',
      description: 'holder1 transferred 5,000 CIPR to holder2',
      legalAnchor: 'UCC 3-603 — payment tendered between holders',
      ...transferReceipt,
      postTransferBalances: {
        holder1: this.cipr.getTrustLine(holder1.address).balance,
        holder2: this.cipr.getTrustLine(holder2.address).balance,
      },
    });

    // ── Step 6 — holder2 burns 5,000 CIPR (full UCC settlement) ────────────
    const burnReceipt  = this.cipr.burn(
      holder2.address,
      '5000',
      'UCC 3-311 / UCC 3-603 — accord & satisfaction; obligation discharged'
    );
    const finalReserve = this.cipr.reserveStatus();
    steps.push({
      step:        6,
      name:        'Settlement',
      description: 'holder2 burned 5,000 CIPR; reserve retired FIFO; obligation discharged',
      legalAnchor: 'UCC 3-311 / UCC 3-603 — tender accepted; reserve offset recorded',
      ...burnReceipt,
      finalReserve: {
        circulatingSupply: finalReserve.circulatingSupply,
        totalReserved:     finalReserve.totalReserved,
        reserveRatio:      finalReserve.reserveRatio,
        remainingEntries:  finalReserve.reserveEntries,
      },
    });

    return {
      lifecycle:   'CipherNex Full Protocol Lifecycle',
      executedAt,
      steps,
      summary: {
        holder1:                  holder1.address,
        holder2:                  holder2.address,
        issued:                   10000,
        transferred:              5000,
        settled:                  5000,
        holder1RemainingBalance:  this.cipr.getTrustLine(holder1.address).balance,
        holder2RemainingBalance:  this.cipr.getTrustLine(holder2.address).balance,
        finalCirculatingSupply:   finalReserve.circulatingSupply,
        reserveRatio:             finalReserve.reserveRatio,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _createWallet() {
    const privateKey = crypto.randomBytes(32);
    return {
      address:    bufferToHex(privateToAddress(privateKey)),
      privateKey: bufferToHex(privateKey),
    };
  }

  // Lazily resolved — available only after start() is called
  get _port() {
    return process.env.PROTOCOL_PORT || 3002;
  }
}

module.exports = ProtocolService;
