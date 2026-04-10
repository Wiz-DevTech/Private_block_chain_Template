const Token = require('./Token');
const Stablecoin = require('./Stablecoin');

class TokenManager {
  constructor() {
    this.tokens = {};
  }

  createToken(name, symbol, description, decimals = 18) {
    if (this.tokens[symbol]) {
      throw new Error(`Token ${symbol} already exists`);
    }

    this.tokens[symbol] = new Token(name, symbol, decimals, description);
    return this.tokens[symbol];
  }

  createStablecoin(name, symbol, pegAsset = 'USD', decimals = 6) {
    if (this.tokens[symbol]) {
      throw new Error(`Token ${symbol} already exists`);
    }

    this.tokens[symbol] = new Stablecoin(name, symbol, pegAsset, decimals);
    return this.tokens[symbol];
  }

  getToken(symbol) {
    const token = this.tokens[symbol];
    if (!token) {
      throw new Error(`Token ${symbol} does not exist`);
    }
    return token;
  }

  mint(symbol, address, amount) {
    return this.getToken(symbol).mint(address, amount);
  }

  transfer(symbol, from, to, amount) {
    return this.getToken(symbol).transfer(from, to, amount);
  }

  balanceOf(symbol, address) {
    return this.getToken(symbol).getBalance(address);
  }
}

module.exports = TokenManager;
