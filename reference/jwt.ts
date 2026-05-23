/**
 * x402-mesh — minimal ed25519 JWT helpers built on Node Web Crypto.
 *
 * No external JWT library: we want this to be a single-file dependency
 * any vendor can copy into their stack. ed25519 / EdDSA only — keeps
 * tokens compact and the verification path obvious.
 */

import type { MeshTokenClaims } from './types';

function b64urlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): Uint8Array {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const s = atob(input.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Generate an ed25519 keypair. Returns base64url-encoded raw bytes for
 *  both keys — the format the registry stores and that vendors share. */
export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return {
    publicKey: b64urlEncode(new Uint8Array(pub)),
    privateKey: b64urlEncode(new Uint8Array(priv)),
  };
}

async function importPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', b64urlDecode(b64), { name: 'Ed25519' }, false, ['sign']);
}

async function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64urlDecode(b64), { name: 'Ed25519' }, false, ['verify']);
}

export async function signToken(claims: MeshTokenClaims, privateKeyB64: string, kid: string): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT', kid };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(privateKeyB64);
  const sig = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

export interface VerifyOptions {
  /** Expected audience (target vendor_id). Token's `aud` must match this or be "*". */
  audience: string;
  /** Resolver: kid → public key (base64url). Throw or return null if unknown. */
  resolvePublicKey: (kid: string) => Promise<string | null> | string | null;
  /** Optional clock skew tolerance in seconds. Default 30. */
  clockSkewSec?: number;
}

export interface VerifyResult {
  ok: boolean;
  claims?: MeshTokenClaims;
  error?: string;
}

export async function verifyToken(token: string, opts: VerifyOptions): Promise<VerifyResult> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, error: 'malformed-token' };
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64))) as { alg: string; kid: string };
    if (header.alg !== 'EdDSA') return { ok: false, error: 'unsupported-alg' };
    if (!header.kid) return { ok: false, error: 'missing-kid' };

    const pubB64 = await opts.resolvePublicKey(header.kid);
    if (!pubB64) return { ok: false, error: 'unknown-issuer' };
    const pub = await importPublicKey(pubB64);
    const ok = await crypto.subtle.verify(
      'Ed25519', pub, b64urlDecode(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!ok) return { ok: false, error: 'bad-signature' };

    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as MeshTokenClaims;
    const skew = opts.clockSkewSec ?? 30;
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp + skew < now) return { ok: false, error: 'expired' };
    if (claims.iat - skew > now) return { ok: false, error: 'not-yet-valid' };
    if (claims.aud !== '*' && claims.aud !== opts.audience) return { ok: false, error: 'audience-mismatch' };

    return { ok: true, claims };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 80) : 'verify-failed' };
  }
}
