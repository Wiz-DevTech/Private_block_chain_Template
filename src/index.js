const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { bufferToHex, privateToAddress } = require('ethereumjs-util');
const Blockchain = require('./blockchain/Blockchain');
const ContractManager = require('./blockchain/ContractManager');
const APIServer = require('./network/APIServer');
const P2PServer = require('./network/P2PServer');
const RPCServer = require('./rpc/RPCServer');
const config = require('./config');

const accountsFilePath = path.join(__dirname, '..', 'Genesis-accounts.json');

function generateAccount() {
  const privateKey = crypto.randomBytes(32);
  const address = bufferToHex(privateToAddress(privateKey));
  return {
    address,
    privateKey: bufferToHex(privateKey),
  };
}

function createGenesisAccounts() {
  const accounts = Array.from({ length: 5 }, () => ({
    ...generateAccount(),
    balance: 100000,
  }));
  fs.writeFileSync(accountsFilePath, JSON.stringify(accounts, null, 2));
  return accounts;
}

function getGenesisAccounts() {
  if (fs.existsSync(accountsFilePath)) {
    return JSON.parse(fs.readFileSync(accountsFilePath, 'utf8'));
  }
  return null;
}

function printAccountSummary(accounts) {
  accounts.forEach((account, index) => {
    console.log(`Account ${index + 1}:`);
    console.log(`Address: ${account.address}`);
    console.log(`Private Key: ${account.privateKey}`);
    console.log(`Balance: ${account.balance}`);
    console.log('');
  });
}

function printStartupInfo(httpPort, p2pPort, rpcPort) {
  console.log('WIBT Network Node Starting...');
  console.log(`P2P Server Running on ws://localhost:${p2pPort}`);
  console.log('CipherNex Blockchain Node Running Successfully');
  console.log('');
  console.log('Quick Start Guide:');
  console.log('\t1. Import a genesis account private key into MetaMask');
  console.log('\t2. Add the network to MetaMask using the RPC URL above');
  console.log('\t3. Start sending transactions');
  console.log('');
  console.log(`RPC Server running on http://localhost:${rpcPort}`);
  console.log(`Chain ID: ${config.CHAIN_ID}`);
  console.log(`RPC Chain ID (hex): 0x${Number(config.CHAIN_ID).toString(16)}`);
  console.log(`Network Name: ${config.NETWORK_NAME}`);
  console.log(`Auto-Mining: ${config.AUTO_MINING ? 'ENABLED' : 'DISABLED'}`);
  console.log('');
  console.log('Add to MetaMask:');
  console.log(`\t- Network Name: ${config.NETWORK_NAME}`);
  console.log(`\t- RPC URL: http://localhost:${rpcPort}`);
  console.log(`\t- Chain ID: ${config.CHAIN_ID}`);
  console.log(`\t- Currency Symbol: ${config.CURRENCY_SYMBOL}`);
  console.log('');
  console.log(`API Server running on http://localhost:${httpPort}`);
  console.log('API Documentation:');
  console.log('\t- GET /api/blocks');
  console.log('\t- GET /api/blocks/:number');
  console.log('\t- POST /api/transactions');
  console.log('\t- GET /api/transactions/pending');
  console.log('\t- POST /api/wallet/create');
  console.log('\t- GET /api/wallet/balance/:address');
  console.log('\t- POST /api/mine');
  console.log('\t- POST /api/contracts/deploy');
  console.log('\t- GET /api/contracts');
  console.log('\t- GET /api/info');
  console.log('');
  console.log('CIPR Issuance API (XRPL-aligned):');
  console.log('\t- POST /api/cipr/trustset         — Step 3: establish trust line');
  console.log('\t- POST /api/cipr/issue            — Step 4: mint CIPR (issuer → destination)');
  console.log('\t- POST /api/cipr/transfer         — Transfer CIPR between holders');
  console.log('\t- POST /api/cipr/burn             — Burn CIPR (return to issuer)');
  console.log('\t- POST /api/cipr/freeze           — Step 5a: freeze/unfreeze trust line');
  console.log('\t- POST /api/cipr/globalfreeze     — Step 5b: global freeze/unfreeze');
  console.log('\t- GET  /api/cipr/reserve          — Reserve status & supply metrics');
  console.log('\t- GET  /api/cipr/balance/:address — Trust line balance');
  console.log('\t- GET  /api/cipr/trustlines       — All registered trust lines');
  console.log('');
  console.log(`CIPR Issuer (cold):    ${config.CIPR_ISSUER_ADDRESS}`);
  console.log(`CIPR Hot Wallet:       ${config.CIPR_HOT_WALLET_ADDRESS}`);
  console.log(`CIPR Max Supply:       ${config.CIPR_MAX_SUPPLY}`);
  console.log(`CIPR Transfer Rate:    ${config.CIPR_TRANSFER_RATE} bps`);
  console.log(`UCC Anchors:           ${config.CIPR_UCC_ANCHOR}`);
}

const genesisAccounts = getGenesisAccounts();

if (!genesisAccounts) {
  console.log('No Genesis accounts file found');
  console.log('');
  console.log('Initializing genesis accounts...');
  console.log('');
}

const accounts = genesisAccounts || createGenesisAccounts();

if (!genesisAccounts) {
  printAccountSummary(accounts);
  console.log('Genesis accounts saved to Genesis-accounts.json');
  console.log('');
}

const blockchain = new Blockchain({
  chainId: config.CHAIN_ID,
  networkName: config.NETWORK_NAME,
  currencySymbol: config.CURRENCY_SYMBOL,
  autoMining: config.AUTO_MINING,
  difficulty: config.MINING_DIFFICULTY,
  miningReward: config.MINING_REWARD,
  initialBalances: accounts.map((account) => ({
    address: account.address,
    amount: account.balance,
  })),
});

const contractManager = new ContractManager();
const apiServer = new APIServer(blockchain, contractManager);
const p2pServer = new P2PServer(blockchain);
const rpcServer = new RPCServer(blockchain, contractManager);

const HTTP_PORT = process.env.API_PORT || config.DEFAULT_API_PORT;
const P2P_PORT = process.env.P2P_PORT || config.DEFAULT_P2P_PORT;
const RPC_PORT = process.env.RPC_PORT || config.DEFAULT_RPC_PORT;
const P2P_PEERS = process.env.P2P_PEERS
  ? process.env.P2P_PEERS.split(',').map((peer) => peer.trim())
  : config.DEFAULT_P2P_PEERS;

apiServer.start(HTTP_PORT);
p2pServer.listen(P2P_PORT);
if (P2P_PEERS.length > 0) {
  p2pServer.connectToPeers(P2P_PEERS);
}
rpcServer.start(RPC_PORT);

printStartupInfo(HTTP_PORT, P2P_PORT, RPC_PORT);
