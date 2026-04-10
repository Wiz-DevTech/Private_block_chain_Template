class Token {
  constructor(name, symbol, decimals = 18, description = '', logo = '') {
    this.name = name;
    this.symbol = symbol;
    this.decimals = decimals;
    this.description = description;
    this.logo = logo;
    this.balances = {};
  }

  getBalance(address) {
    return this.balances[address] || 0;
  }

  mint(to, amount) {
    if (!to || amount <= 0) {
      throw new Error('Invalid mint request');
    }

    this.balances[to] = this.getBalance(to) + amount;
    return this.getBalance(to);
  }

  burn(from, amount) {
    if (!from || amount <= 0 || this.getBalance(from) < amount) {
      throw new Error('Invalid burn request');
    }

    this.balances[from] -= amount;
    return this.getBalance(from);
  }

  transfer(from, to, amount) {
    if (!from || !to || amount <= 0) {
      throw new Error('Invalid transfer request');
    }

    if (this.getBalance(from) < amount) {
      throw new Error('Insufficient token balance');
    }

    this.balances[from] -= amount;
    this.balances[to] = this.getBalance(to) + amount;
    return { from: this.getBalance(from), to: this.getBalance(to) };
  }
}

module.exports = Token;
