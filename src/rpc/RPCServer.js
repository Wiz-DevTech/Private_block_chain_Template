const express = require('express');
const bodyParser = require('body-parser');

// 1 CIPR = 10^18 Wei (same denomination as ETH/Wei)
const WEI_PER_UNIT = BigInt('1000000000000000000');

function toWeiHex(balance) {
  return `0x${(BigInt(Math.round(Number(balance))) * WEI_PER_UNIT).toString(16)}`;
}

class RPCServer {
  constructor(blockchain, contractManager) {
    this.blockchain = blockchain;
    this.contractManager = contractManager;
    this.app = express();

    // CORS — MetaMask is a browser extension and requires permissive CORS
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
      next();
    });

    this.app.use(bodyParser.json());
    this.registerRpcMethods();
  }

  registerRpcMethods() {
    // MetaMask sends JSON-RPC 2.0 requests to the root path
    this.app.post('/', (req, res) => {
      const { id, method, params = [] } = req.body;

      const ok = (result) => res.json({ jsonrpc: '2.0', id, result });
      const err = (code, message) =>
        res.status(400).json({ jsonrpc: '2.0', id, error: { code, message } });

      try {
        switch (method) {
          // ── Network / chain identity ──────────────────────────────────────
          case 'eth_chainId': {
            const chainId = Number(this.blockchain.chainId);
            return ok(`0x${chainId.toString(16)}`);
          }

          case 'net_version':
            return ok(String(this.blockchain.chainId));

          case 'net_listening':
            return ok(true);

          case 'web3_clientVersion':
            return ok('PrivateChain/1.0.0');

          // ── Block information ─────────────────────────────────────────────
          case 'eth_blockNumber': {
            const blockNumber = this.blockchain.chain.length - 1;
            return ok(`0x${blockNumber.toString(16)}`);
          }

          case 'eth_getBlockByNumber': {
            const [blockTag] = params;
            let block;
            if (blockTag === 'latest' || blockTag === 'pending') {
              block = this.blockchain.getLatestBlock();
            } else {
              const index = parseInt(blockTag, 16);
              block = this.blockchain.chain[index] || null;
            }
            if (!block) return ok(null);
            return ok(this._formatBlock(block));
          }

          case 'eth_getBlockByHash': {
            const [hash] = params;
            const block = this.blockchain.chain.find((b) => b.hash === hash) || null;
            return ok(block ? this._formatBlock(block) : null);
          }

          // ── Account / balance ─────────────────────────────────────────────
          case 'eth_accounts':
            return ok([]);

          case 'eth_getBalance': {
            const [address] = params;
            const balance = this.blockchain.getBalanceOfAddress(address || '');
            return ok(toWeiHex(balance));
          }

          case 'eth_getTransactionCount':
            // Return a static nonce of 0 — extend when tx signing is supported
            return ok('0x0');

          case 'eth_getCode':
            return ok('0x');

          case 'eth_getStorageAt':
            return ok('0x0000000000000000000000000000000000000000000000000000000000000000');

          // ── Gas ───────────────────────────────────────────────────────────
          case 'eth_gasPrice':
            return ok('0x1');

          case 'eth_estimateGas':
            return ok('0x5208'); // 21000 gas

          case 'eth_feeHistory':
            return ok({ oldestBlock: '0x0', baseFeePerGas: ['0x1'], gasUsedRatio: [0] });

          // ── Transactions ──────────────────────────────────────────────────
          case 'eth_sendRawTransaction':
            return err(-32000, 'eth_sendRawTransaction not supported — use the API server');

          case 'eth_getTransactionReceipt':
            return ok(null);

          case 'eth_getTransactionByHash':
            return ok(null);

          // ── Calls / filters ───────────────────────────────────────────────
          case 'eth_call':
            return ok('0x');

          case 'eth_newFilter':
          case 'eth_newBlockFilter':
          case 'eth_newPendingTransactionFilter':
            return ok('0x1');

          case 'eth_getFilterChanges':
          case 'eth_getFilterLogs':
            return ok([]);

          case 'eth_uninstallFilter':
            return ok(true);

          case 'eth_getLogs':
            return ok([]);

          // ── Custom / legacy methods ───────────────────────────────────────
          case 'getBlockchain':
            return ok(this.blockchain.chain);

          case 'getBalance': {
            const balance = this.blockchain.getBalanceOfAddress(params[0]);
            return ok(balance);
          }

          case 'getTokenBalance':
            return ok(this.contractManager.tokenManager.balanceOf(params[0], params[1]));

          case 'getNetworkInfo':
            return ok({
              chainId: this.blockchain.chainId,
              networkName: this.blockchain.networkName,
              currencySymbol: this.blockchain.currencySymbol,
              autoMining: this.blockchain.autoMining,
            });

          default:
            return err(-32601, `Method not found: ${method}`);
        }
      } catch (error) {
        return err(-32603, error.message);
      }
    });

    // Keep /rpc path working for any existing tooling
    this.app.post('/rpc', (req, res) => {
      req.url = '/';
      this.app._router.handle(req, res);
    });
  }

  _formatBlock(block) {
    const index = this.blockchain.chain.indexOf(block);
    return {
      number: `0x${index.toString(16)}`,
      hash: block.hash,
      parentHash: block.previousHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
      nonce: '0x0000000000000000',
      sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
      logsBloom: '0x' + '0'.repeat(512),
      transactionsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      receiptsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      miner: '0x0000000000000000000000000000000000000000',
      difficulty: `0x${(block.difficulty || 0).toString(16)}`,
      totalDifficulty: '0x0',
      extraData: '0x',
      size: '0x1000',
      gasLimit: '0x1c9c380',
      gasUsed: '0x0',
      timestamp: `0x${Math.floor(new Date(block.timestamp).getTime() / 1000).toString(16)}`,
      transactions: (block.transactions || []).map((tx) => tx.hash || '0x0'),
      uncles: [],
    };
  }

  start(port) {
    this.app.listen(port, () => {
      console.log(`RPC Server listening on http://localhost:${port}`);
    });
  }
}

module.exports = RPCServer;
