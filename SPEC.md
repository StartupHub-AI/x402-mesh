# x402-mesh v0.1 — wire spec

x402-mesh is a light extension of [x402](https://github.com/coinbase/x402) that adds two things on top of `402 Payment Required`: a peer menu and a settlement primitive. This document is the normative v0.1 spec.

## 1. The 402 body

A 402 response from an x402-mesh-aware vendor carries a `mesh` object alongside the standard x402 `accepts[]`. Vanilla x402 clients read only `accepts[]` and are unaffected.

```json
{
  "protocol": "x402-mesh/0.1",
  "self": {
    "vendor_id": "startuphub",
    "name": "StartupHub Email Validator",
    "category": "email-validation",
    "endpoint": "https://api.startuphub.ai/v1/validate",
    "method": "POST",
    "price": { "amount_cents": 3, "currency": "USD", "unit": "per_call" },
    "quality": { "accuracy": 0.95, "p95_latency_ms": 250 }
  },
  "alternatives": [
    {
      "vendor_id": "hunter",
      "name": "Hunter Email Verifier",
      "endpoint": "https://api.hunter.io/v2/email-verifier",
      "method": "GET",
      "price": { "amount_cents": 4, "currency": "USD", "unit": "per_call" },
      "quality": { "accuracy": 0.93, "p95_latency_ms": 320 },
      "referral_token": "eyJhbGciOiJFZERTQSIs..."
    }
  ],
  "settle": {
    "url": "https://api.startuphub.ai/api/x402-mesh/settle",
    "registry_url": "https://api.startuphub.ai/api/x402-mesh/registry"
  }
}
```

### Field requirements

- `protocol` — exact string `x402-mesh/0.1`. Required.
- `self.vendor_id` — short slug, must match the issuer's registry entry.
- `self.price.amount_cents` — integer cents. `unit` is one of `per_call`, `per_token_in`, `per_token_out`, `per_kb`, `per_seat_month`, `flat`.
- `alternatives[]` — 0 to 10 entries, ordered by the issuer's relevance judgement. `referral_token` is required for any entry the issuer wants attribution for; entries without a token are pure information.
- `settle.url` — POST endpoint where the target vendor reports redemption.

## 2. Referral token

A JWT signed by the **referring** vendor's private key. ed25519 / EdDSA only, which keeps tokens compact and the verification path obvious.

```
header:  { "alg": "EdDSA", "typ": "JWT", "kid": "<vendor_id>" }
payload: {
  "iss": "<referrer_vendor_id>",
  "aud": "<target_vendor_id>",
  "iat": 1745920800,
  "exp": 1745921100,
  "jti": "uuid-v4",
  "cat": "email-validation",
  "cpct": 5,
  "act_chain": [ ... ]   // optional, see section 6
}
```

The target vendor MUST:

1. Look up the issuer's public key by `kid` from a compliant registry.
2. Verify the signature.
3. Verify `aud` matches its own `vendor_id` (or is `*`).
4. Verify `exp` is in the future.
5. Reject any token whose `jti` it has seen before (single use).

## 3. Settlement

When an agent presents a referral token and pays, the target POSTs the settlement endpoint named in the original 402:

```
POST /api/x402-mesh/settle
{
  "jti": "<from token>",
  "referrer_vendor_id": "<from token iss>",
  "target_vendor_id": "<self>",
  "category": "<from token cat>",
  "amount_cents": 4,
  "commission_pct": 5,
  "payment_proof": { "kind": "tx_hash", "ref": "0x..." }
}
```

The settlement service records the redemption under `jti`, then pays the referrer their commission. Settlement can be self-hosted, federated, or third-party. The spec does not mandate one rail; the reference implementation supports an atomic on-chain USDC split on Base, Stripe Connect, and manual invoicing.

### Atomic on-chain split

The reference rail is a non-custodial splitter contract. The agent pays the contract, which forwards the vendor share and referrer commission in one transaction. The contract holds no balance between calls, has no owner, and cannot be upgraded. The `MeshPaid` event it emits carries the `jti`, so the settlement service reconciles on-chain settlement against the ledger with one log read. See [`contracts/MeshSplitter.sol`](./contracts/MeshSplitter.sol).

## 4. Discovery — `/.well-known/x402-mesh.json`

A vendor advertises participation with a manifest at `/.well-known/x402-mesh.json`:

```json
{
  "protocol": "x402-mesh/0.1",
  "vendor_id": "startuphub",
  "categories": ["email-validation"],
  "registry_url": "https://www.startuphub.ai/api/x402-mesh/registry"
}
```

A vendor is participating if and only if this file is publicly fetchable, parses as JSON, and the `protocol` + `vendor_id` fields are valid.

## 5. Registry

Vendors register a public key plus endpoint metadata once:

```
POST /api/x402-mesh/registry
{
  "vendor_id": "your-slug",
  "name": "Your API",
  "category": "email-validation",
  "endpoint": "https://api.example.com/v1",
  "public_key": "<base64url ed25519>",
  "contact": "you@example.com",
  "wallet": "0xYourBaseAddress"
}
```

`wallet` is the zero-friction crypto-native payout path: a single Base address becomes a top-priority on-chain payout rail. Vendors mixing fiat rails pass an explicit `payout_rails` array instead.

Anyone can read:

```
GET /api/x402-mesh/registry?category=email-validation
GET /api/x402-mesh/registry/<vendor_id>
```

A vendor's identity is defined by its public key; the registry just maps `vendor_id` to that key plus endpoint metadata. If the registry goes down, vendors with cached keys keep working.

## 6. Identity composition (optional)

x402-mesh does not define agent identity. It composes with external standards:

- **Catena ACK-ID** (W3C DIDs and Verifiable Credentials)
- **IETF WIMSE** and **OAuth 2.0 Token Exchange (RFC 8693)**
- **A2A**

The optional `act_chain` claim mirrors the actor-chain pattern (issuer, subject, audience, per-hop timestamps) so a referred payment can carry verifiable delegation lineage: which agent paid, acting on whose behalf, referred by whom. A target that does not care about provenance ignores the claim. A target that does can enforce policy on the full lineage before accepting payment.

## 7. Honest defaults

- Commission: 5% of the target's revenue from the referred call. Negotiable bilaterally; encoded per token in `cpct`.
- Token TTL: 5 minutes. Long enough for an agent to think, short enough that stale prices do not get redeemed.
- Categories: lowercase, kebab-case. Not gatekept. The de-facto vocabulary emerges from usage.
- Quality fields: optional but recommended. The spec mandates no quality framework; independent scorers can publish their own.
