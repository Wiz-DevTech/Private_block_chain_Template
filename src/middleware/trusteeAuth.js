/**
 * trusteeAuth.js — Express middleware that enforces Trustee-only access.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * This middleware guards every route in AdminGateway and DocumentService.
 * A request MUST carry a valid Bearer JWT issued by AuthService and it MUST
 * have the role 'trustee' inside its payload.  Any other request is rejected
 * before it reaches the route handler.
 *
 * This is the boundary between the public API (no authentication required —
 * any participant can query blocks, balances, or trust lines) and the Trustee
 * administration surface (only the cold wallet holder may mint, burn, freeze,
 * enter documents, or issue bills of exchange).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TOKEN FLOW
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Client authenticates via AuthService → receives a JWT
 *   2. Client includes the token in every admin request:
 *        Authorization: Bearer <jwt>
 *   3. This middleware intercepts the request BEFORE the route handler:
 *        a. Extracts the token from the Authorization header
 *        b. Verifies the HMAC-SHA256 signature using the shared JWT_SECRET
 *        c. Checks the 'exp' claim — rejects expired tokens
 *        d. Checks the 'role' claim — must equal 'trustee'
 *        e. Checks the jti (token ID) against the revocation list
 *           (populated when the Trustee logs out via DELETE /auth/logout)
 *        f. Attaches the decoded payload to req.trustee for downstream use
 *   4. If any check fails → 401 Unauthorized or 403 Forbidden is returned
 *   5. If all checks pass → next() is called; the route handler executes
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REVOCATION
 * ─────────────────────────────────────────────────────────────────────────────
 * The revocation list is an in-memory Set shared via the module-level
 * `revokedTokenIds` export.  AuthService populates this set on logout.
 * Because it is in-memory, it is cleared on node restart — tokens expire
 * naturally via their `exp` claim, so revocation is an additional safety net
 * for active logout scenarios rather than a primary security control.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ATTACHED TO req.trustee (available in every protected route handler)
 * ─────────────────────────────────────────────────────────────────────────────
 *   req.trustee.sub  — Trustee's identity (cold wallet address)
 *   req.trustee.role — 'trustee'
 *   req.trustee.iat  — when the token was issued
 *   req.trustee.exp  — when the token expires
 *   req.trustee.jti  — unique token ID
 */

'use strict';

const jwt    = require('../lib/jwt');
const config = require('../config');

// ── In-memory revocation list ─────────────────────────────────────────────────
// Holds jti (token ID) strings of tokens that have been explicitly revoked
// via DELETE /auth/logout.  The same Set instance is shared between this
// middleware and AuthService so that logout takes effect immediately on all
// protected routes without a restart.
const revokedTokenIds = new Set();

/**
 * Express middleware: enforce Trustee JWT authentication.
 *
 * Attach this to any route or router that should be Trustee-only:
 *   router.use(trusteeAuth)  — guard an entire router
 *   router.post('/route', trusteeAuth, handler)  — guard a single route
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function trusteeAuth(req, res, next) {
  // ── Step 1: Extract the Authorization header ─────────────────────────────
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token present — the request is unauthenticated
    return res.status(401).json({
      error:  'Trustee authentication required',
      detail: 'Include a valid Bearer token in the Authorization header',
      hint:   'Authenticate via POST /auth/verify to obtain a token',
    });
  }

  // Extract the raw token string after "Bearer "
  const token = authHeader.slice(7).trim();

  // ── Step 2: Verify signature and expiry ──────────────────────────────────
  let payload;
  try {
    // jwt.verify checks the HMAC-SHA256 signature AND the exp claim.
    // Throws if the token is tampered with, uses the wrong secret, or is expired.
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({
      error:  'Invalid or expired token',
      detail: err.message,
      hint:   'Re-authenticate via POST /auth/verify to obtain a new token',
    });
  }

  // ── Step 3: Enforce Trustee role ─────────────────────────────────────────
  // A valid JWT is not enough — the token must carry the 'trustee' role claim.
  // This distinction allows the same auth infrastructure to later support
  // read-only 'observer' tokens that can call GET routes but not POST/PATCH.
  if (payload.role !== 'trustee') {
    return res.status(403).json({
      error:  'Trustee role required',
      detail: `Token carries role '${payload.role}' — only 'trustee' is permitted on this route`,
    });
  }

  // ── Step 4: Check revocation list ────────────────────────────────────────
  // If the Trustee explicitly logged out, this jti will be in the revoked set.
  if (revokedTokenIds.has(payload.jti)) {
    return res.status(401).json({
      error:  'Token has been revoked',
      detail: 'This token was invalidated on logout — please re-authenticate',
    });
  }

  // ── Step 5: Attach decoded payload and proceed ───────────────────────────
  // Downstream route handlers access Trustee identity via req.trustee.
  // Example: req.trustee.sub === config.CIPR_ISSUER_ADDRESS
  req.trustee = payload;

  // All checks passed — allow the request to reach the route handler
  next();
}

module.exports = { trusteeAuth, revokedTokenIds };
