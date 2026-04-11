/**
 * AuthService — Trustee identity authentication for Wisdom Ignited Business Trust.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * AuthService is the identity gate of the Trustee administration layer.
 * It answers a single critical question on every login attempt:
 *
 *   "Does this caller know the Trustee's secret — and therefore have the
 *    right to exercise the cold wallet's issuer authority?"
 *
 * The cold wallet address (config.CIPR_ISSUER_ADDRESS) is the public identity
 * of the Trust on the ledger.  The TRUSTEE_ADMIN_SECRET is the private
 * credential proving the caller is the rightful operator of that identity.
 * These two together — the public address and the private secret — define
 * the Trustee role.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION MECHANISM — HMAC Challenge-Response
 * ─────────────────────────────────────────────────────────────────────────────
 * A challenge-response protocol is used instead of a simple password POST
 * because the secret is never transmitted directly over the network:
 *
 *   Step 1 — Client requests a challenge nonce:
 *               GET /auth/challenge
 *             Server generates a unique 32-byte random nonce and stores it
 *             with a 5-minute expiry window.
 *
 *   Step 2 — Client computes the proof:
 *               proof = HMAC-SHA256( nonce, TRUSTEE_ADMIN_SECRET )
 *             The secret is used as the HMAC key, the nonce as the message.
 *             This produces a unique proof per challenge — replay attacks
 *             are impossible because each nonce is single-use.
 *
 *   Step 3 — Client submits the proof:
 *               POST /auth/verify { address, nonce, proof }
 *             Server independently computes the expected proof using its own
 *             copy of TRUSTEE_ADMIN_SECRET.  If it matches (constant-time
 *             comparison) AND the address matches CIPR_ISSUER_ADDRESS, the
 *             caller is authenticated as the Trustee.
 *
 *   Step 4 — Server issues a JWT:
 *             The JWT carries { sub: address, role: 'trustee', exp: now + TTL }.
 *             All admin routes verify this token via the trusteeAuth middleware.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ADDRESS IS CHECKED
 * ─────────────────────────────────────────────────────────────────────────────
 * The `address` field in the verify request must match config.CIPR_ISSUER_ADDRESS.
 * This binds the authentication event to the specific cold wallet that holds
 * mint authority on the CIPR ledger.  A valid HMAC proof from any other address
 * is rejected — only the declared issuer identity may authenticate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENDPOINTS
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET    /auth/challenge   — Request a one-time nonce
 *   POST   /auth/verify      — Submit HMAC proof, receive JWT
 *   POST   /auth/refresh     — Exchange a valid JWT for a fresh one
 *   GET    /auth/status      — Check if a token is still valid
 *   DELETE /auth/logout      — Revoke the current token immediately
 *   GET    /                 — Service index
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES
 * ─────────────────────────────────────────────────────────────────────────────
 *   TRUSTEE_ADMIN_SECRET  — The Trustee's private HMAC key.
 *                           MUST be set before the node starts.
 *                           Never log or expose this value.
 *   JWT_SECRET            — The HMAC key used to sign JWT tokens.
 *                           May differ from TRUSTEE_ADMIN_SECRET.
 *   JWT_EXPIRES_IN        — Token lifetime in seconds (default: 3600 = 1 hour).
 *   AUTH_PORT             — Port to listen on (default: 3003).
 */

'use strict';

const express    = require('express');
const bodyParser = require('body-parser');
const crypto     = require('crypto');
const jwt        = require('../lib/jwt');
const { revokedTokenIds } = require('../middleware/trusteeAuth');
const config     = require('../config');

class AuthService {
  /**
   * Construct the AuthService.
   *
   * On construction:
   *   - Express app is created and JSON body parsing is attached.
   *   - An in-memory nonce store is initialised (Map: nonce → { address, expiresAt }).
   *   - All routes are registered.
   *
   * The service is stateless between requests EXCEPT for the nonce store and
   * the shared revokedTokenIds Set imported from trusteeAuth.js.
   */
  constructor() {
    this.app = express();
    this.app.use(bodyParser.json());

    // ── Nonce store ───────────────────────────────────────────────────────────
    // Maps each issued challenge nonce to { address, expiresAt }.
    // Nonces expire after NONCE_TTL_MS to prevent replay attacks.
    // Each nonce is single-use: consumed on successful verification.
    this._nonces = new Map();

    // ── Nonce TTL: 5 minutes ──────────────────────────────────────────────────
    // A challenge must be answered within this window or it expires.
    this._NONCE_TTL_MS = 5 * 60 * 1000;

    // ── Periodic nonce cleanup ────────────────────────────────────────────────
    // Remove expired nonces every minute to prevent memory growth.
    setInterval(() => this._pruneExpiredNonces(), 60 * 1000);

    this._registerRoutes();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC — start the service
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start the HTTP server on the given port.
   * @param {number} port
   */
  start(port) {
    this.app.listen(port, () => {
      console.log(`[AuthService] Trustee Authentication Service  → http://localhost:${port}`);
      console.log(`[AuthService] Challenge endpoint             → GET  http://localhost:${port}/auth/challenge`);
      console.log(`[AuthService] Verify endpoint                → POST http://localhost:${port}/auth/verify`);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  _registerRoutes() {

    // ── Service index ─────────────────────────────────────────────────────────
    this.app.get('/', (req, res) => {
      res.json({
        service:  'CipherNex AuthService — Trustee Authentication',
        version:  '1.0.0',
        issuer:   config.CIPR_ISSUER_ADDRESS,
        endpoints: {
          'GET    /auth/challenge': 'Request a one-time challenge nonce',
          'POST   /auth/verify':   'Submit HMAC proof, receive Trustee JWT',
          'POST   /auth/refresh':  'Exchange valid JWT for a fresh one',
          'GET    /auth/status':   'Check if current token is still valid',
          'DELETE /auth/logout':   'Revoke the current token immediately',
        },
        howToAuthenticate: [
          '1. GET /auth/challenge  →  receive { nonce }',
          '2. Compute proof = HMAC-SHA256(nonce, TRUSTEE_ADMIN_SECRET)',
          '3. POST /auth/verify  { address: CIPR_ISSUER_ADDRESS, nonce, proof }',
          '4. Receive { token }  — use as  Authorization: Bearer <token>',
        ],
      });
    });

    // ── GET /auth/challenge ───────────────────────────────────────────────────
    //
    // STEP 1 of authentication.
    // Generates a cryptographically random 32-byte nonce and stores it
    // with a 5-minute expiry.  The nonce is single-use — it is consumed
    // (removed from the store) on first successful verification.
    //
    // The client must answer this challenge within the TTL window.
    // A new challenge must be requested if the window closes.
    this.app.get('/auth/challenge', (req, res) => {
      // Generate a high-entropy nonce — 32 random bytes encoded as hex (64 chars)
      const nonce     = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + this._NONCE_TTL_MS;

      // Store the nonce — associated with the issuer address for double-binding
      // The address field will be confirmed again on /auth/verify
      this._nonces.set(nonce, {
        address:   config.CIPR_ISSUER_ADDRESS, // expected address on verification
        expiresAt,                              // absolute expiry timestamp
      });

      res.json({
        nonce,                                          // 64-char hex nonce to sign
        expiresAt:  new Date(expiresAt).toISOString(), // human-readable expiry
        ttlSeconds: this._NONCE_TTL_MS / 1000,         // window in seconds
        instruction:
          'Compute proof = HMAC-SHA256(nonce, TRUSTEE_ADMIN_SECRET) ' +
          'then POST /auth/verify with { address, nonce, proof }',
      });
    });

    // ── POST /auth/verify ─────────────────────────────────────────────────────
    //
    // STEP 2 of authentication.
    // The client submits:
    //   address — must match config.CIPR_ISSUER_ADDRESS (cold wallet / Trustee)
    //   nonce   — the exact nonce received from /auth/challenge
    //   proof   — HMAC-SHA256(nonce, TRUSTEE_ADMIN_SECRET) as a hex string
    //
    // The server independently computes the expected proof using its own copy
    // of TRUSTEE_ADMIN_SECRET.  Comparison is constant-time to prevent
    // timing-based attacks.  On success, a Trustee JWT is issued.
    //
    // The nonce is consumed immediately on success — it cannot be reused.
    this.app.post('/auth/verify', (req, res) => {
      try {
        const { address, nonce, proof } = req.body;

        // ── Validate required fields ────────────────────────────────────────
        if (!address || !nonce || !proof) {
          return res.status(400).json({
            error:  'Missing required fields',
            required: ['address', 'nonce', 'proof'],
          });
        }

        // ── Validate address matches the Trustee identity ───────────────────
        // Only the cold wallet holder may authenticate as Trustee.
        if (address !== config.CIPR_ISSUER_ADDRESS) {
          return res.status(403).json({
            error:  'Address does not match the registered Trustee issuer address',
            detail: 'Only the cold wallet holder (CIPR_ISSUER_ADDRESS) may authenticate',
          });
        }

        // ── Look up the nonce ───────────────────────────────────────────────
        const stored = this._nonces.get(nonce);
        if (!stored) {
          return res.status(401).json({
            error:  'Nonce not found or already consumed',
            detail: 'Request a fresh nonce from GET /auth/challenge',
          });
        }

        // ── Check nonce expiry ──────────────────────────────────────────────
        if (Date.now() > stored.expiresAt) {
          this._nonces.delete(nonce); // clean up expired nonce
          return res.status(401).json({
            error:  'Challenge nonce has expired',
            detail: `The ${this._NONCE_TTL_MS / 1000}-second window has passed`,
            hint:   'Request a fresh nonce from GET /auth/challenge',
          });
        }

        // ── Compute the expected proof ──────────────────────────────────────
        // HMAC-SHA256(nonce, TRUSTEE_ADMIN_SECRET)
        // The secret is the HMAC key; the nonce is the message.
        const expectedProof = crypto
          .createHmac('sha256', config.TRUSTEE_ADMIN_SECRET)
          .update(nonce)
          .digest('hex');

        // ── Constant-time comparison ────────────────────────────────────────
        // crypto.timingSafeEqual prevents timing attacks where an attacker
        // could guess the secret one byte at a time by measuring response time.
        const proofA = Buffer.from(proof,          'utf8');
        const proofB = Buffer.from(expectedProof,  'utf8');

        const isValid = proofA.length === proofB.length &&
                        crypto.timingSafeEqual(proofA, proofB);

        if (!isValid) {
          // Do NOT reveal whether address or proof was wrong — just reject
          return res.status(401).json({ error: 'Authentication failed — invalid proof' });
        }

        // ── Consume the nonce (single-use) ──────────────────────────────────
        // Remove from the store so it cannot be replayed even if intercepted.
        this._nonces.delete(nonce);

        // ── Issue the Trustee JWT ───────────────────────────────────────────
        // The token carries the Trustee identity and role for all admin routes.
        const token = jwt.sign(
          {
            sub:     address,      // Trustee's cold wallet address (subject)
            role:    'trustee',    // role claim — enforced by trusteeAuth middleware
            issuer:  config.CIPR_ISSUER_ADDRESS, // confirms which issuance they control
          },
          config.JWT_SECRET,
          config.JWT_EXPIRES_IN   // token lifetime in seconds
        );

        const decoded = jwt.decode(token);
        res.json({
          status:     'authenticated',
          role:       'trustee',
          subject:    address,                              // Trustee's identity
          token,                                           // Bearer token for admin routes
          expiresAt:  new Date(decoded.exp * 1000).toISOString(),
          usage:      'Add to requests: Authorization: Bearer <token>',
          adminUrl:   `http://localhost:${config.DEFAULT_ADMIN_PORT}`,
        });

      } catch (err) {
        res.status(500).json({ error: 'Authentication error', detail: err.message });
      }
    });

    // ── POST /auth/refresh ────────────────────────────────────────────────────
    //
    // Exchange a still-valid Trustee JWT for a fresh one with a new expiry.
    // Allows the Trustee to maintain a session without re-doing the full
    // challenge-response flow.
    //
    // The existing token must be valid and not yet expired.  The jti of the
    // old token is revoked immediately so it cannot be reused after refresh.
    this.app.post('/auth/refresh', (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Bearer token required in Authorization header' });
        }

        const oldToken = authHeader.slice(7).trim();

        // Verify the existing token — must be valid to refresh
        const payload = jwt.verify(oldToken, config.JWT_SECRET);

        if (payload.role !== 'trustee') {
          return res.status(403).json({ error: 'Only Trustee tokens can be refreshed' });
        }

        // Revoke the old token immediately so it cannot be used after refresh
        revokedTokenIds.add(payload.jti);

        // Issue a fresh token with the same claims but a new expiry and jti
        const newToken = jwt.sign(
          { sub: payload.sub, role: 'trustee', issuer: payload.issuer },
          config.JWT_SECRET,
          config.JWT_EXPIRES_IN
        );

        const decoded = jwt.decode(newToken);
        res.json({
          status:    'refreshed',
          token:     newToken,
          expiresAt: new Date(decoded.exp * 1000).toISOString(),
        });

      } catch (err) {
        res.status(401).json({ error: 'Refresh failed', detail: err.message });
      }
    });

    // ── GET /auth/status ──────────────────────────────────────────────────────
    //
    // Check whether the current Bearer token is valid and not revoked.
    // Useful for the Trustee dashboard to display session state.
    // Returns 200 if valid, 401 if invalid/expired/revoked.
    this.app.get('/auth/status', (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ authenticated: false, reason: 'No token provided' });
        }

        const token   = authHeader.slice(7).trim();
        const payload = jwt.verify(token, config.JWT_SECRET);

        // Check revocation
        if (revokedTokenIds.has(payload.jti)) {
          return res.status(401).json({ authenticated: false, reason: 'Token revoked' });
        }

        const now      = Math.floor(Date.now() / 1000);
        const ttlSecs  = payload.exp - now;

        res.json({
          authenticated: true,
          role:          payload.role,
          subject:       payload.sub,
          expiresAt:     new Date(payload.exp * 1000).toISOString(),
          ttlSeconds:    ttlSecs,
          // Warn if less than 10 minutes remaining so the client can refresh
          refreshAdvisory: ttlSecs < 600
            ? 'Token expires soon — call POST /auth/refresh to extend the session'
            : null,
        });

      } catch (err) {
        res.status(401).json({ authenticated: false, reason: err.message });
      }
    });

    // ── DELETE /auth/logout ───────────────────────────────────────────────────
    //
    // Immediately revoke the current Bearer token by adding its jti to the
    // in-memory revocation list.  The token will be rejected on all protected
    // routes even before its natural expiry.
    //
    // This is the Trustee equivalent of locking the admin panel — important
    // when stepping away from a session on a shared machine.
    this.app.delete('/auth/logout', (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(400).json({ error: 'Bearer token required to logout' });
        }

        const token = authHeader.slice(7).trim();

        // Decode without verifying — we still want to revoke an expired token
        const payload = jwt.decode(token);
        if (payload && payload.jti) {
          revokedTokenIds.add(payload.jti); // add to shared revocation list
        }

        res.json({
          status:  'logged out',
          message: 'Token has been revoked — it will be rejected on all admin routes',
        });

      } catch (err) {
        res.status(500).json({ error: 'Logout error', detail: err.message });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Remove all expired nonces from the store.
   * Called on a 60-second interval by the constructor's setInterval.
   * Prevents unbounded memory growth if many challenges are requested
   * without being answered.
   */
  _pruneExpiredNonces() {
    const now = Date.now();
    for (const [nonce, stored] of this._nonces.entries()) {
      if (now > stored.expiresAt) {
        this._nonces.delete(nonce);
      }
    }
  }
}

module.exports = AuthService;
