#!/usr/bin/env node
'use strict';

/**
 * CipherNex Lifecycle Test Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Walks through the full six-step CIPR lifecycle against the Protocol
 * Microservice (default: http://localhost:3002).
 *
 * Usage:
 *   # Start the protocol microservice first:
 *   node src/server/protocol.js
 *
 *   # Then run this script in another terminal:
 *   node scripts/lifecycle-test.js
 *   PROTOCOL_URL=http://localhost:3002 node scripts/lifecycle-test.js
 *
 * Each step prints:
 *   • The equivalent curl command
 *   • The actual HTTP response
 *   • A PASS / FAIL result
 *
 * Exit code: 0 = all steps passed, 1 = one or more failures.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL  = (process.env.PROTOCOL_URL || 'http://localhost:3002').replace(/\/$/, '');
const VERBOSE   = process.env.VERBOSE === '1';   // set VERBOSE=1 to print full responses

// ── ANSI colours ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
};

// ── Shared state threaded through the test ───────────────────────────────────

const state = {
  holder1:     null,  // { address, privateKey }
  holder2:     null,
  issuedAmount: 10000,
  transferAmt:  5000,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function banner(text) {
  const line = '─'.repeat(70);
  console.log(`\n${C.bold}${C.cyan}${line}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${line}${C.reset}`);
}

function heading(step, name) {
  console.log(`\n${C.bold}${C.yellow}Step ${step} — ${name}${C.reset}`);
}

function curlBlock(method, path, body) {
  const url   = `${BASE_URL}${path}`;
  const lines = [];
  if (body) {
    lines.push(`${C.dim}curl -X ${method} ${url} \\`);
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '${JSON.stringify(body)}'${C.reset}`);
  } else {
    lines.push(`${C.dim}curl ${url}${C.reset}`);
  }
  console.log(lines.join('\n'));
}

function pass(label) {
  console.log(`${C.green}  ✓  ${label}${C.reset}`);
}

function fail(label, detail) {
  console.log(`${C.red}  ✗  ${label}${C.reset}`);
  if (detail) console.log(`     ${C.red}${detail}${C.reset}`);
}

function info(label, value) {
  console.log(`  ${C.dim}${label}:${C.reset} ${value}`);
}

function printVerbose(data) {
  if (VERBOSE) {
    console.log(`\n${C.dim}${JSON.stringify(data, null, 2)}${C.reset}`);
  }
}

async function request(method, path, body) {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await axios({ method, url, data: body });
    return { ok: true, status: res.status, data: res.data };
  } catch (err) {
    const status = err.response ? err.response.status : 0;
    const data   = err.response ? err.response.data   : { error: err.message };
    return { ok: false, status, data };
  }
}

// ── Test steps ───────────────────────────────────────────────────────────────

async function checkServiceReachable() {
  heading('0', 'Service health check');
  curlBlock('GET', '/', null);

  const { ok, data } = await request('GET', '/', null);
  if (!ok) {
    fail('Protocol microservice is not reachable');
    console.log(`\n${C.red}  Start it with:  node src/server/protocol.js${C.reset}\n`);
    return false;
  }
  pass(`Service online — ${data.network} (chainId: ${data.chainId})`);
  info('Issuer',    data.issuer);
  info('Hot wallet', data.hotWallet);
  return true;
}

async function stepGenesis() {
  heading('1', 'Genesis — reserve status at startup');
  curlBlock('GET', '/protocol/genesis', null);

  const { ok, data } = await request('GET', '/protocol/genesis', null);
  if (!ok) { fail('GET /protocol/genesis failed', data.error); return false; }
  printVerbose(data);

  const supply = parseFloat(data.reserve.circulatingSupply);
  if (supply > 0) {
    pass(`Circulating supply at genesis: ${supply.toLocaleString()} ${data.reserve.currency}`);
    info('Reserve entries', data.reserve.reserveEntries);
    info('Legal anchor',   data.legalAnchor);
    return true;
  }
  fail('Genesis supply should be > 0', `got: ${data.reserve.circulatingSupply}`);
  return false;
}

async function stepCreateAccounts() {
  heading('2', 'Account — create holder wallets');

  // holder1
  curlBlock('POST', '/protocol/account', {});
  const r1 = await request('POST', '/protocol/account', {});
  if (!r1.ok) { fail('Create holder1 failed', r1.data.error); return false; }
  state.holder1 = r1.data.wallet;
  pass(`holder1 created: ${state.holder1.address}`);
  printVerbose(r1.data);

  // holder2
  const r2 = await request('POST', '/protocol/account', {});
  if (!r2.ok) { fail('Create holder2 failed', r2.data.error); return false; }
  state.holder2 = r2.data.wallet;
  pass(`holder2 created: ${state.holder2.address}`);

  info('Note', r1.data.description);
  return true;
}

async function stepTrustSet() {
  heading('3', 'TrustSet — establish trust lines');

  // TrustSet for holder1
  const body1 = { holderAddress: state.holder1.address, limit: '1000000000' };
  curlBlock('POST', '/protocol/trustset', body1);
  const r1 = await request('POST', '/protocol/trustset', body1);
  if (!r1.ok) { fail('TrustSet holder1 failed', r1.data.error); return false; }
  pass(`holder1 trust line open — limit: ${r1.data.trustLine.limit} ${r1.data.trustLine.currency}`);
  printVerbose(r1.data);

  // TrustSet for holder2
  const body2 = { holderAddress: state.holder2.address, limit: '1000000000' };
  const r2 = await request('POST', '/protocol/trustset', body2);
  if (!r2.ok) { fail('TrustSet holder2 failed', r2.data.error); return false; }
  pass(`holder2 trust line open — limit: ${r2.data.trustLine.limit} ${r2.data.trustLine.currency}`);
  info('Legal anchor', r1.data.legalAnchor);
  return true;
}

async function stepIssue() {
  heading('4', 'Issue — mint CIPR to holder1');

  const body = {
    destinationAddress: state.holder1.address,
    amount:            String(state.issuedAmount),
    reserveReference:  `RESERVE-TEST-${Date.now()}`,
    memo:              '12 USC 411 — issued against trust reserve for lifecycle test',
  };
  curlBlock('POST', '/protocol/issue', body);

  const { ok, data } = await request('POST', '/protocol/issue', body);
  if (!ok) { fail('Issue failed', data.error); return false; }
  printVerbose(data);

  const balance = parseFloat(data.trustLineBalance);
  if (balance === state.issuedAmount) {
    pass(`${state.issuedAmount.toLocaleString()} CIPR minted to holder1`);
    info('Reserve reference', data.reserveEntry.reference);
    info('New circulating supply', data.newCirculatingSupply);
    info('Legal anchor', data.legalAnchor);
    return true;
  }
  fail(`Expected balance ${state.issuedAmount}, got ${balance}`);
  return false;
}

async function stepTransfer() {
  heading('5', 'Transfer — holder1 → holder2');

  const body = {
    fromAddress: state.holder1.address,
    toAddress:   state.holder2.address,
    amount:      String(state.transferAmt),
    memo:        'Lifecycle test: holder-to-holder payment',
  };
  curlBlock('POST', '/protocol/transfer', body);

  const { ok, data } = await request('POST', '/protocol/transfer', body);
  if (!ok) { fail('Transfer failed', data.error); return false; }
  printVerbose(data);

  const h1Bal = parseFloat(data.postTransferBalances[state.holder1.address]);
  const h2Bal = parseFloat(data.postTransferBalances[state.holder2.address]);

  const expectedH1 = state.issuedAmount - state.transferAmt;
  if (h1Bal === expectedH1 && h2Bal === parseFloat(data.netAmount)) {
    pass(`Transfer complete — holder1: ${h1Bal} CIPR, holder2: ${h2Bal} CIPR`);
    info('Gross',      `${data.grossAmount} CIPR`);
    info('Fee',        `${data.fee} CIPR`);
    info('Net to h2',  `${data.netAmount} CIPR`);
    info('Legal anchor', data.legalAnchor);
    return true;
  }
  fail(`Balance mismatch — holder1: ${h1Bal}, holder2: ${h2Bal}`);
  return false;
}

async function stepSettle() {
  heading('6', 'Settlement — holder2 burns CIPR (UCC 3-311/3-603)');

  // Get holder2's current balance to burn the exact amount
  const balRes = await request('GET', `/protocol/balance/${state.holder2.address}`, null);
  if (!balRes.ok) { fail('Could not fetch holder2 balance', balRes.data.error); return false; }
  const burnAmount = balRes.data.balance;

  const body = {
    holderAddress: state.holder2.address,
    amount:        burnAmount,
    memo:          'UCC 3-311 / UCC 3-603 — accord & satisfaction; obligation discharged',
  };
  curlBlock('POST', '/protocol/settle', body);

  const { ok, data } = await request('POST', '/protocol/settle', body);
  if (!ok) { fail('Settlement (burn) failed', data.error); return false; }
  printVerbose(data);

  pass(`${burnAmount} CIPR burned — obligation discharged`);
  info('Post-settlement supply', data.postSettlementReserve.circulatingSupply);
  info('Reserve ratio',         data.postSettlementReserve.reserveRatio);
  info('Legal anchor',          data.legalAnchor);
  return true;
}

async function verifyFinalState() {
  heading('*', 'Final state verification');

  const { ok, data } = await request('GET', '/protocol/reserve', null);
  if (!ok) { fail('Could not fetch reserve status'); return false; }

  const circ = parseFloat(data.circulatingSupply);
  const reserved = parseFloat(data.totalReserved);

  pass(`Final circulating supply: ${circ.toLocaleString()} CIPR`);
  pass(`Final reserve total:      ${reserved.toLocaleString()} CIPR`);
  info('Reserve ratio', data.reserveRatio);
  info('Reserve entries', data.reserveEntries);
  if (data.reserveRatio !== 'N/A') {
    info('Backing', parseFloat(data.reserveRatio) >= 1.0 ? `${C.green}fully backed${C.reset}` : `${C.yellow}partially backed${C.reset}`);
  }
  return true;
}

// ── Automated full-run endpoint ───────────────────────────────────────────────

async function runAutomatedLifecycle() {
  banner('POST /protocol/run — Automated Full Lifecycle Demo');
  curlBlock('POST', '/protocol/run', {});

  const { ok, data } = await request('POST', '/protocol/run', {});
  if (!ok) {
    fail('POST /protocol/run failed', data.error);
    return false;
  }

  console.log(`\n${C.bold}Lifecycle: ${data.lifecycle}${C.reset}`);
  console.log(`Executed:  ${data.executedAt}`);

  for (const step of data.steps) {
    console.log(`\n  ${C.yellow}Step ${step.step} — ${step.name}${C.reset}`);
    console.log(`  ${C.dim}${step.description}${C.reset}`);
  }

  const s = data.summary;
  console.log(`\n${C.bold}Summary:${C.reset}`);
  info('holder1',         s.holder1);
  info('holder2',         s.holder2);
  info('Issued',          `${s.issued.toLocaleString()} CIPR`);
  info('Transferred',     `${s.transferred.toLocaleString()} CIPR`);
  info('Settled',         `${s.settled.toLocaleString()} CIPR`);
  info('h1 remaining',    `${s.holder1RemainingBalance} CIPR`);
  info('h2 remaining',    `${s.holder2RemainingBalance} CIPR`);
  info('Final supply',    `${parseFloat(s.finalCirculatingSupply).toLocaleString()} CIPR`);
  info('Reserve ratio',   s.reserveRatio);

  pass('Automated lifecycle completed successfully');
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner(`CipherNex Lifecycle Test  →  ${BASE_URL}`);
  console.log(`${C.dim}Set VERBOSE=1 to print full response bodies.${C.reset}`);
  console.log(`${C.dim}Set PROTOCOL_URL to point at a remote node.${C.reset}`);

  const results = [];

  const reachable = await checkServiceReachable();
  if (!reachable) process.exit(1);

  // Part A — Manual step-by-step walk-through
  banner('Part A — Step-by-step Manual Walk-through');
  results.push({ name: 'Step 1 Genesis',       ok: await stepGenesis()         });
  results.push({ name: 'Step 2 Account',        ok: await stepCreateAccounts()  });
  results.push({ name: 'Step 3 TrustSet',       ok: await stepTrustSet()        });
  results.push({ name: 'Step 4 Issue',          ok: await stepIssue()           });
  results.push({ name: 'Step 5 Transfer',       ok: await stepTransfer()        });
  results.push({ name: 'Step 6 Settlement',     ok: await stepSettle()          });
  results.push({ name: 'Final state verify',    ok: await verifyFinalState()    });

  // Part B — Automated endpoint
  banner('Part B — Automated Lifecycle via POST /protocol/run');
  results.push({ name: 'Automated lifecycle',  ok: await runAutomatedLifecycle() });

  // ── Summary ───────────────────────────────────────────────────────────────
  banner('Results');
  let passed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ${C.green}✓${C.reset}  ${r.name}`);
      passed++;
    } else {
      console.log(`  ${C.red}✗${C.reset}  ${r.name}`);
    }
  }

  console.log(`\n${C.bold}${passed}/${results.length} tests passed${C.reset}`);

  if (passed < results.length) {
    console.log(`\n${C.red}Some tests failed.${C.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${C.green}${C.bold}All tests passed.${C.reset}\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${C.red}Unexpected error: ${err.message}${C.reset}`);
  process.exit(1);
});
