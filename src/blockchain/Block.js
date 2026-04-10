const crypto = require('crypto');
const Transaction = require('./Transaction');

class Block {
  constructor(timestamp = Date.now(), transactions = [], previousHash = '', metadata = {}) {
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.metadata = metadata;
    this.hash = this.computeHash();
  }

  computeHash() {
    return crypto
      .createHash('sha256')
      .update(this.previousHash + this.timestamp + JSON.stringify(this.transactions) + JSON.stringify(this.metadata) + this.nonce)
      .digest('hex');
  }

  mine(difficulty) {
    const target = '0'.repeat(difficulty);
    while (this.hash.substring(0, difficulty) !== target) {
      this.nonce += 1;
      this.hash = this.computeHash();
    }
  }

  static fromJSON(data) {
    const transactions = data.transactions.map((tx) => Transaction.fromJSON(tx));
    const block = new Block(data.timestamp, transactions, data.previousHash, data.metadata || {});
    block.nonce = data.nonce;
    block.hash = data.hash;
    return block;
  }
}

module.exports = Block;
