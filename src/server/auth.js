'use strict';

/**
 * Standalone entry point for the CipherNex AuthService.
 *
 * Starts only the authentication microservice — no blockchain or CIPR context
 * is needed.  AuthService is a pure identity gate that issues JWTs.
 *
 * Usage:
 *   node src/server/auth.js
 *   AUTH_PORT=3003 TRUSTEE_ADMIN_SECRET=mysecret node src/server/auth.js
 *
 * Environment variables:
 *   AUTH_PORT             — port to listen on (default: 3003)
 *   TRUSTEE_ADMIN_SECRET  — the HMAC key used for challenge-response auth
 *   JWT_SECRET            — the key used to sign JWTs
 *   JWT_EXPIRES_IN        — token lifetime in seconds (default: 3600)
 *   CIPR_ISSUER_ADDRESS   — the cold wallet address that is the Trustee identity
 */

const AuthService = require('../microservices/AuthService');
const config      = require('../config');

const service = new AuthService();
const port    = Number(process.env.AUTH_PORT) || config.DEFAULT_AUTH_PORT;

service.start(port);
