const Blockchain = require('../blockchain/Blockchain');
const ContractManager = require('../blockchain/ContractManager');
const APIServer = require('../network/APIServer');
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
const apiServer = new APIServer(blockchain, contractManager);
const port = process.env.API_PORT || config.DEFAULT_API_PORT;

apiServer.start(port);
console.log(`API server started on http://localhost:${port}`);
