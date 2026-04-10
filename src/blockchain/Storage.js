const fs = require('fs');
const path = require('path');
const Block = require('./Block');
const Transaction = require('./Transaction');

const dataPath = path.join(__dirname, '..', '..', 'data');
const chainFilePath = path.join(dataPath, 'chain.json');
const genesisFilePath = path.join(dataPath, 'genesis.json');

function ensureDataDirectory() {
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }
}

function convertTransaction(raw) {
  return Transaction.fromJSON(raw);
}

function convertBlock(raw) {
  return Block.fromJSON({
    timestamp: raw.timestamp,
    transactions: raw.transactions || [],
    previousHash: raw.previousHash,
    nonce: raw.nonce,
    hash: raw.hash,
  });
}

function loadChain() {
  if (!fs.existsSync(chainFilePath)) {
    return null;
  }

  const rawData = fs.readFileSync(chainFilePath, 'utf8');
  const savedBlocks = JSON.parse(rawData);
  return savedBlocks.map(convertBlock);
}

function saveGenesis(block) {
  ensureDataDirectory();
  if (!fs.existsSync(genesisFilePath)) {
    fs.writeFileSync(genesisFilePath, JSON.stringify(block, null, 2));
  }
}

function saveChain(chain) {
  ensureDataDirectory();
  const serializableChain = chain.map((block) => ({
    timestamp: block.timestamp,
    transactions: block.transactions,
    previousHash: block.previousHash,
    nonce: block.nonce,
    hash: block.hash,
    metadata: block.metadata || {},
  }));

  fs.writeFileSync(chainFilePath, JSON.stringify(serializableChain, null, 2));
  saveGenesis(chain[0]);
}

module.exports = {
  loadChain,
  saveChain,
  saveGenesis,
  chainFilePath,
  genesisFilePath,
};
