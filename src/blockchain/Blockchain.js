const Block = require('./Block');
const { loadChain, saveChain, saveGenesis } = require('./Storage');

class Blockchain {
  constructor(config = {}) {
    this.chainId = config.chainId || 'ciphernex-chain-1';
    this.networkName = config.networkName || 'CipherNex';
    this.currencySymbol = config.currencySymbol || 'CIPR';
    this.autoMining = config.autoMining ?? false;
    this.difficulty = config.difficulty || 2;
    this.pendingTransactions = [];
    this.miningReward = config.miningReward || 100;
    const loadedChain = loadChain();
    this.chain = loadedChain || [this.createGenesisBlock(config.initialBalances)];
    if (!loadedChain) {
      saveChain(this.chain);
    }
  }

  createGenesisBlock(initialBalances = []) {
    const genesisTransactions = (initialBalances || []).map((balanceEntry) => ({
      fromAddress: null,
      toAddress: balanceEntry.address,
      amount: balanceEntry.amount,
      memo: 'Genesis allocation',
      timestamp: Date.now(),
    }));

    const genesisBlock = new Block('2026-01-01', genesisTransactions, '0', {
      chainId: this.chainId,
      networkName: this.networkName,
      currencySymbol: this.currencySymbol,
      createdAt: '2026-01-01T00:00:00Z',
    });

    saveGenesis(genesisBlock);
    return genesisBlock;
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  minePendingTransactions(rewardAddress) {
    const block = new Block(Date.now(), this.pendingTransactions, this.getLatestBlock().hash);
    block.mine(this.difficulty);

    this.chain.push(block);
    saveChain(this.chain);

    this.pendingTransactions = [
      {
        fromAddress: null,
        toAddress: rewardAddress,
        amount: this.miningReward,
        timestamp: Date.now(),
      },
    ];

    return block;
  }

  addTransaction(transaction) {
    if (!transaction.fromAddress || !transaction.toAddress) {
      throw new Error('Transaction must include from and to address');
    }

    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to chain');
    }

    this.pendingTransactions.push(transaction);
  }

  getBalanceOfAddress(address) {
    let balance = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress === address) {
          balance -= tx.amount;
        }

        if (tx.toAddress === address) {
          balance += tx.amount;
        }
      }
    }

    for (const pending of this.pendingTransactions) {
      if (pending.fromAddress === address) {
        balance -= pending.amount;
      }

      if (pending.toAddress === address) {
        balance += pending.amount;
      }
    }

    return balance;
  }

  isChainValid() {
    for (let i = 1; i < this.chain.length; i += 1) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (currentBlock.hash !== currentBlock.computeHash()) {
        return false;
      }

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }

      for (const tx of currentBlock.transactions) {
        if (tx.fromAddress && !tx.isValid()) {
          return false;
        }
      }
    }

    return true;
  }
}

module.exports = Blockchain;
