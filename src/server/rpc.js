const Blockchain = require('../blockchain/Blockchain');
const ContractManager = require('../blockchain/ContractManager');
const RPCServer = require('../rpc/RPCServer');
const config = require('../config');

const blockchain = new Blockchain({
  chainId: config.CHAIN_ID,
  networkName: config.NETWORK_NAME,
  currencySymbol: config.CURRENCY_SYMBOL,
  autoMining: config.AUTO_MINING,
  difficulty: config.MINING_DIFFICULTY,
  miningReward: config.MINING_REWARD,
});

const contractManager = new ContractManager();
const rpcServer = new RPCServer(blockchain, contractManager);
const port = process.env.RPC_PORT || config.DEFAULT_RPC_PORT;

rpcServer.start(port);
console.log(`RPC server started on http://localhost:${port}`);
