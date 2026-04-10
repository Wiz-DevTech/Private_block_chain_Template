const Token = require('./Token');

class Stablecoin extends Token {
  constructor(name, symbol, pegAsset = 'USD', decimals = 6) {
    super(name, symbol, decimals, `${symbol} pegged 1:1 to ${pegAsset}`);
    this.pegAsset = pegAsset;
    this.pegRate = 1;
  }

  mintPegged(to, amount) {
    return this.mint(to, amount);
  }

  getPeggedValue(amount) {
    return amount * this.pegRate;
  }
}

module.exports = Stablecoin;
