/**
 * jwt.js — Lightweight HS256 JWT implementation using only Node.js built-in crypto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * JSON Web Tokens (RFC 7519) are the standard bearer token format used to
 * prove identity across HTTP services.  Rather than adding an external
 * dependency (jsonwebtoken), this module implements HS256 (HMAC-SHA256) JWT
 * using only Node.js's built-in `crypto` module — keeping the dependency
 * surface minimal and the implementation fully auditable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * JWT STRUCTURE  (three base64url-encoded segments separated by dots)
 * ─────────────────────────────────────────────────────────────────────────────
 *   HEADER    { alg: 'HS256', typ: 'JWT' }
 *   PAYLOAD   { sub, role, iat, exp, jti, ...custom }
 *   SIGNATURE HMAC-SHA256( header + '.' + payload, secret )
 *
 * The signature binds the header and payload together — any modification to
 * either section produces a completely different HMAC, making tampering
 * immediately detectable on verification.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PAYLOAD FIELDS
 * ─────────────────────────────────────────────────────────────────────────────
 *   sub  — subject (Trustee's cold wallet address or identifier)
 *   role — 'trustee' | 'observer' (controls which routes are accessible)
 *   iat  — issued-at timestamp (Unix seconds)
 *   exp  — expiry timestamp (Unix seconds)
 *   jti  — JWT ID — unique per token (enables revocation tracking)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECURITY NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 * - The `secret` must be a high-entropy string (set via JWT_SECRET env var).
 * - Tokens are short-lived (default 1 hour); refresh before expiry.
 * - The jti field enables a revocation list in AuthService.
 * - NEVER expose the secret to client-side code or logs.
 */

'use strict';

const crypto = require('crypto');

// ── base64url helpers ────────────────────────────────────────────────────────
// RFC 4648 §5: base64url replaces '+' with '-', '/' with '_', and strips '='
// padding.  This produces URL-safe tokens without percent-encoding.

/**
 * Encode a string or Buffer to base64url format.
 * @param {string|Buffer} input
 * @returns {string}
 */
function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')   // URL-safe: replace + with -
    .replace(/\//g, '_')   // URL-safe: replace / with _
    .replace(/=/g, '');    // strip padding
}

/**
 * Decode a base64url string back to a UTF-8 string.
 * @param {string} input
 * @returns {string}
 */
function b64urlDecode(input) {
  // Restore standard base64 padding before decoding
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// ── Standard JWT header — HS256 algorithm, JWT type ─────────────────────────
const HEADER = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

// ── Internal: compute HMAC-SHA256 signature ──────────────────────────────────

/**
 * Compute HMAC-SHA256 over the signing input (header.payload) with the secret.
 * Returns the signature as a base64url string.
 *
 * @param {string} signingInput - '<header>.<payload>' (both base64url encoded)
 * @param {string} secret       - HMAC key
 * @returns {string} base64url-encoded HMAC digest
 */
function computeSignature(signingInput, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign and encode a JWT token.
 *
 * Flow:
 *   1. Build the payload with iat (issued-at) and exp (expiry) timestamps.
 *   2. Generate a unique jti (JWT ID) for revocation tracking.
 *   3. base64url-encode the header and payload.
 *   4. Compute HMAC-SHA256 over 'header.payload'.
 *   5. Concatenate all three segments with '.' separators.
 *
 * @param {object} payload         - Claims to encode (sub, role, etc.)
 * @param {string} secret          - HMAC key (from config.JWT_SECRET)
 * @param {number} [expiresIn=3600] - Token lifetime in seconds (default: 1 hour)
 * @returns {string} signed JWT string
 */
function sign(payload, secret, expiresIn = 3600) {
  const now = Math.floor(Date.now() / 1000); // current Unix time in seconds

  // Build the full claim set
  const fullPayload = {
    ...payload,
    iat: now,                          // issued at
    exp: now + expiresIn,             // expires at (absolute Unix timestamp)
    jti: crypto.randomBytes(16).toString('hex'), // unique token ID for revocation
  };

  // Step 1 — Encode header and payload as base64url
  const encodedPayload   = b64urlEncode(JSON.stringify(fullPayload));
  const signingInput     = `${HEADER}.${encodedPayload}`;

  // Step 2 — Compute the signature
  const signature = computeSignature(signingInput, secret);

  // Step 3 — Assemble the three-part JWT
  return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT token's signature and expiry.
 *
 * Flow:
 *   1. Split the token into its three segments.
 *   2. Recompute the HMAC over 'header.payload'.
 *   3. Compare the recomputed signature to the stored signature using
 *      crypto.timingSafeEqual (prevents timing attacks).
 *   4. Decode and parse the payload.
 *   5. Check the `exp` field — reject if token is expired.
 *
 * @param {string} token  - JWT string to verify
 * @param {string} secret - HMAC key (must match the key used to sign)
 * @returns {object} decoded payload if valid
 * @throws {Error} if the signature is invalid, token is malformed, or expired
 */
function verify(token, secret) {
  // Step 1 — Split and validate structure (must have exactly three parts)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token — expected three segments separated by dots');
  }

  const [headerPart, payloadPart, tokenSignature] = parts;

  // Step 2 — Recompute the signature from the received header and payload
  const expectedSignature = computeSignature(`${headerPart}.${payloadPart}`, secret);

  // Step 3 — Constant-time comparison to prevent timing-based signature forgery
  const sigA = Buffer.from(tokenSignature,      'utf8');
  const sigB = Buffer.from(expectedSignature,   'utf8');

  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    throw new Error('Invalid token signature — token has been tampered with or signed with a different secret');
  }

  // Step 4 — Decode and parse the verified payload
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadPart));
  } catch {
    throw new Error('Malformed token payload — JSON parse failed');
  }

  // Step 5 — Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) {
    throw new Error(`Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
  }

  return payload; // caller receives the verified, decoded claims
}

/**
 * Decode a JWT payload WITHOUT verifying the signature.
 *
 * Used ONLY for extracting the jti (token ID) before verification, or for
 * diagnostic logging.  NEVER use this output to make security decisions.
 *
 * @param {string} token
 * @returns {object|null} decoded payload, or null if the token is malformed
 */
function decode(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return null;
  }
}

module.exports = { sign, verify, decode };
