const WebSocket = require('ws');
const Block = require('../blockchain/Block');
const { saveChain } = require('../blockchain/Storage');

const MESSAGE_TYPES = {
  CHAIN: 'CHAIN',
  TRANSACTION: 'TRANSACTION',
};

class P2PServer {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.sockets = [];
  }

  listen(port) {
    const server = new WebSocket.Server({ port });
    server.on('connection', (socket) => this.initConnection(socket));
  }

  connectToPeers(peerUrls = []) {
    peerUrls.forEach((peerUrl) => {
      const socket = new WebSocket(peerUrl);

      socket.on('open', () => {
        console.log(`Connected to peer ${peerUrl}`);
        this.initConnection(socket);
      });

      socket.on('error', (error) => {
        console.warn(`Failed to connect to peer ${peerUrl}: ${error.message}`);
      });
    });
  }

  initConnection(socket) {
    this.sockets.push(socket);
    this.initMessageHandler(socket);
    this.sendChain(socket);
  }

  initMessageHandler(socket) {
    socket.on('message', (data) => {
      const message = JSON.parse(data);
      switch (message.type) {
        case MESSAGE_TYPES.CHAIN:
          this.handleReceiveChain(message.chain);
          break;
        default:
          break;
      }
    });
  }

  sendChain(socket) {
    socket.send(JSON.stringify({ type: MESSAGE_TYPES.CHAIN, chain: this.blockchain.chain }));
  }

  broadcastChain() {
    this.sockets.forEach((socket) => this.sendChain(socket));
  }

  handleReceiveChain(chain) {
    const remoteChain = chain.map((blockData) => Block.fromJSON(blockData));
    if (remoteChain.length > this.blockchain.chain.length && this.isValidChain(remoteChain)) {
      this.blockchain.chain = remoteChain;
      saveChain(this.blockchain.chain);
      console.log('Replaced local chain with longer valid remote chain');
    }
  }

  isValidChain(chain) {
    if (!chain || chain.length === 0) {
      return false;
    }

    for (let i = 1; i < chain.length; i += 1) {
      const currentBlock = chain[i];
      const previousBlock = chain[i - 1];

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

module.exports = P2PServer;
