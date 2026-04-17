/**
 * RESOLVIT - PKCE Utilities for OAuth 2.0
 * Implementation of RFC 7636 (Proof Key for Code Exchange)
 */

const PKCE = {
  /**
   * Generates a random code verifier.
   * A high-entropy cryptographic random string using unreserved characters.
   */
  generateVerifier(length = 64) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let verifier = '';
    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
      verifier += charset[randomValues[i] % charset.length];
    }
    return verifier;
  },

  /**
   * Generates a code challenge from a code verifier.
   * Uses SHA-256 hashing and Base64URL encoding.
   */
  async generateChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    return this.base64url(hash);
  },

  /**
   * Decodes a buffer safely into a Base64URL string.
   */
  base64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
  }
};

// Expose globally for use in auth flows
window.PKCE = PKCE;
