const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const Transaction = require('../blockchain/Transaction');
const { bufferToHex, privateToAddress } = require('ethereumjs-util');

class APIServer {
  constructor(blockchain, contractManager) {
    this.blockchain = blockchain;
    this.contractManager = contractManager;
    this.app = express();
    this.app.use(bodyParser.json());
    this.registerRoutes();
  }

  createWallet() {
    const privateKey = crypto.randomBytes(32);
    return {
      address: bufferToHex(privateToAddress(privateKey)),
      privateKey: bufferToHex(privateKey),
    };
  }

  registerRoutes() {
    this.app.get('/', (req, res) => {
      res.json({
        name: 'CipherNex API',
        version: '1.0.0',
        network: this.blockchain.networkName,
        chainId: this.blockchain.chainId,
        currency: this.blockchain.currencySymbol,
      });
    });

    this.app.get('/api/blocks', (req, res) => {
      res.json(this.blockchain.chain);
    });

    this.app.get('/api/blocks/:number', (req, res) => {
      const index = Number(req.params.number);
      if (Number.isNaN(index) || index < 0 || index >= this.blockchain.chain.length) {
        return res.status(404).json({ error: 'Block not found' });
      }
      res.json(this.blockchain.chain[index]);
    });

    this.app.post('/api/transactions', (req, res) => {
      try {
        const { fromAddress, toAddress, amount, signature, memo } = req.body;
        const transaction = new Transaction(fromAddress, toAddress, amount, memo);
        if (signature) {
          transaction.signature = signature;
        }

        this.blockchain.addTransaction(transaction);
        res.json({ status: 'success', transaction });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/api/transactions/pending', (req, res) => {
      res.json({ pendingTransactions: this.blockchain.pendingTransactions });
    });

    this.app.post('/api/wallet/create', (req, res) => {
      const wallet = this.createWallet();
      res.json({ status: 'success', wallet });
    });

    this.app.get('/api/wallet/balance/:address', (req, res) => {
      res.json({ address: req.params.address, balance: this.blockchain.getBalanceOfAddress(req.params.address) });
    });

    this.app.post('/api/mine', (req, res) => {
      try {
        const { rewardAddress } = req.body;
        if (!rewardAddress) {
          throw new Error('Missing rewardAddress');
        }
        const block = this.blockchain.minePendingTransactions(rewardAddress);
        res.json({ status: 'success', block });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/api/contracts/deploy', (req, res) => {
      try {
        const { name, symbol, description, decimals } = req.body;
        const contract = this.contractManager.tokenManager.createToken(name, symbol, description, decimals || 18);
        res.json({ status: 'success', contract });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/api/contracts', (req, res) => {
      const contracts = Object.values(this.contractManager.tokenManager.tokens || {}).map((token) => ({
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        description: token.description,
        logo: token.logo,
      }));
      res.json({ contracts });
    });

    this.app.get('/api/info', (req, res) => {
      res.json({
        chainId: this.blockchain.chainId,
        networkName: this.blockchain.networkName,
        currencySymbol: this.blockchain.currencySymbol,
        autoMining: this.blockchain.autoMining,
      });
    });

    // ------------------------------------------------------------------
    // CIPR / XRPL-aligned issued-currency routes
    // ------------------------------------------------------------------

    // Step 3 — TrustSet: holder establishes trust line toward issuer
    // POST /api/cipr/trustset  { holderAddress, limit? }
    this.app.post('/api/cipr/trustset', (req, res) => {
      try {
        const { holderAddress, limit } = req.body;
        if (!holderAddress) throw new Error('holderAddress is required');
        const tl = this.contractManager.ciprIssuance.trustSet(holderAddress, limit);
        res.json({ status: 'success', transactionType: 'TrustSet', trustLine: tl.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Step 4 — Payment (mint): issuer → destination
    // POST /api/cipr/issue  { destinationAddress, amount, reserveReference, memo? }
    this.app.post('/api/cipr/issue', (req, res) => {
      try {
        const { destinationAddress, amount, reserveReference, memo } = req.body;
        if (!destinationAddress || !amount || !reserveReference) {
          throw new Error('destinationAddress, amount, and reserveReference are required');
        }
        const receipt = this.contractManager.ciprIssuance.issue(
          destinationAddress, String(amount), reserveReference, memo
        );
        res.json({ status: 'success', ...receipt });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // CIPR transfer between two holders (both must have trust lines)
    // POST /api/cipr/transfer  { fromAddress, toAddress, amount, memo? }
    this.app.post('/api/cipr/transfer', (req, res) => {
      try {
        const { fromAddress, toAddress, amount, memo } = req.body;
        if (!fromAddress || !toAddress || !amount) {
          throw new Error('fromAddress, toAddress, and amount are required');
        }
        const receipt = this.contractManager.ciprIssuance.transfer(
          fromAddress, toAddress, String(amount), memo
        );
        res.json({ status: 'success', ...receipt });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Burn: holder returns CIPR to issuer — tokens destroyed, reserve retired
    // POST /api/cipr/burn  { holderAddress, amount, memo? }
    this.app.post('/api/cipr/burn', (req, res) => {
      try {
        const { holderAddress, amount, memo } = req.body;
        if (!holderAddress || !amount) throw new Error('holderAddress and amount are required');
        const receipt = this.contractManager.ciprIssuance.burn(holderAddress, String(amount), memo);
        res.json({ status: 'success', ...receipt });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Step 5a — Individual trust line freeze
    // POST /api/cipr/freeze  { holderAddress, action: 'freeze'|'unfreeze' }
    this.app.post('/api/cipr/freeze', (req, res) => {
      try {
        const { holderAddress, action } = req.body;
        if (!holderAddress || !action) throw new Error('holderAddress and action are required');
        let result;
        if (action === 'freeze') {
          result = this.contractManager.ciprIssuance.freezeTrustLine(holderAddress);
        } else if (action === 'unfreeze') {
          result = this.contractManager.ciprIssuance.unfreezeTrustLine(holderAddress);
        } else {
          throw new Error('action must be "freeze" or "unfreeze"');
        }
        res.json({ status: 'success', ...result });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Step 5b — Global freeze (AccountSet asfGlobalFreeze = 7)
    // POST /api/cipr/globalfreeze  { action: 'freeze'|'unfreeze' }
    this.app.post('/api/cipr/globalfreeze', (req, res) => {
      try {
        const { action } = req.body;
        if (!action) throw new Error('action is required');
        let result;
        if (action === 'freeze') {
          result = this.contractManager.ciprIssuance.setGlobalFreeze();
        } else if (action === 'unfreeze') {
          result = this.contractManager.ciprIssuance.clearGlobalFreeze();
        } else {
          throw new Error('action must be "freeze" or "unfreeze"');
        }
        res.json({ status: 'success', ...result });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Reserve status — circulating supply, reserve ratio, entry count
    // GET /api/cipr/reserve
    this.app.get('/api/cipr/reserve', (req, res) => {
      res.json(this.contractManager.ciprIssuance.reserveStatus());
    });

    // Trust line balance for a specific holder
    // GET /api/cipr/balance/:address
    this.app.get('/api/cipr/balance/:address', (req, res) => {
      const tl = this.contractManager.ciprIssuance.getTrustLine(req.params.address);
      if (!tl) return res.status(404).json({ error: 'No trust line found for this address' });
      res.json({ address: req.params.address, currency: tl.currency, balance: tl.balance, frozen: tl.frozen });
    });

    // All registered trust lines
    // GET /api/cipr/trustlines
    this.app.get('/api/cipr/trustlines', (req, res) => {
      res.json({ trustLines: this.contractManager.ciprIssuance.allTrustLines() });
    });
  }

  start(port) {
    this.app.listen(port);
  }
}

module.exports = APIServer;
