const Blockchain = require('../blockchain/Blockchain');
const P2PServer = require('../network/P2PServer');
const config = require('../config');

const blockchain = new Blockchain({
  chainId: config.CHAIN_ID,
  networkName: config.NETWORK_NAME,
  currencySymbol: config.CURRENCY_SYMBOL,
  autoMining: config.AUTO_MINING,
  difficulty: config.MINING_DIFFICULTY,
  miningReward: config.MINING_REWARD,
});

const p2pServer = new P2PServer(blockchain);
const port = process.env.P2P_PORT || config.DEFAULT_P2P_PORT;
const peers = process.env.P2P_PEERS
  ? process.env.P2P_PEERS.split(',').map((peer) => peer.trim())
  : config.DEFAULT_P2P_PEERS;

p2pServer.listen(port);
if (peers.length > 0) {
  p2pServer.connectToPeers(peers);
}

console.log(`P2P server started on ws://localhost:${port}`);
