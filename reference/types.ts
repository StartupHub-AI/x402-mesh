/**
 * x402-mesh — TypeScript types for the wire format.
 * See SPEC.md for the full spec. Copy this file into your stack freely.
 */

export type PriceUnit =
  | 'per_call'
  | 'per_token_in'
  | 'per_token_out'
  | 'per_kb'
  | 'per_seat_month'
  | 'flat';

export interface MeshPrice {
  amount_cents: number;
  currency: string; // ISO 4217 (USD, EUR, ...)
  unit: PriceUnit;
}

export interface MeshQuality {
  accuracy?: number;            // 0..1
  p95_latency_ms?: number;
  agent_readiness_score?: number; // 0..100
  [k: string]: unknown;
}

export interface MeshSelfEntry {
  vendor_id: string;
  name: string;
  category: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  price: MeshPrice;
  auth?: string;                // free-form: "x402_token", "bearer", "api_key"
  quality?: MeshQuality;
}

export interface MeshAlternativeEntry {
  vendor_id: string;
  name: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  price: MeshPrice;
  quality?: MeshQuality;
  /** JWT signed by the issuer's private key; required for attribution. */
  referral_token?: string;
}

export interface MeshSettleRefs {
  url: string;
  registry_url?: string;
}

export interface MeshResponse {
  protocol: 'x402-mesh/0.1';
  self: MeshSelfEntry;
  alternatives: MeshAlternativeEntry[];
  settle: MeshSettleRefs;
}

/** One hop in the delegation lineage. Mirrors the actor-chain pattern from
 *  IETF WIMSE / OAuth 2.0 Token Exchange (RFC 8693): who acted, for whom,
 *  and when. Optional — targets that do not care about provenance ignore it. */
export interface MeshActor {
  sub: string;   // subject (agent or user identifier)
  iat: number;   // when this hop acted, unix seconds
}

export interface MeshTokenClaims {
  iss: string;     // referrer vendor_id
  aud: string;     // target vendor_id (or "*")
  iat: number;     // issued-at unix seconds
  exp: number;     // expiry unix seconds (default iat + 300)
  jti: string;     // unique referral id
  cat: string;     // category
  cpct: number;    // commission %, integer 0–100
  /** Optional delegation lineage. See SPEC.md section 6 (identity composition). */
  act_chain?: MeshActor[];
}
