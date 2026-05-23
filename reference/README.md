# Reference primitives

The portable core of x402-mesh, with no framework or vendor coupling. Copy
these two files into any TypeScript stack:

- **`types.ts`** — the wire-format types and token claims.
- **`jwt.ts`** — ed25519 sign/verify built on Web Crypto. No external JWT
  library, so the verification path is auditable in one file.

```ts
import { generateKeyPair, signToken, verifyToken } from './jwt';

// Referrer: mint a 5-minute referral token for a peer.
const { publicKey, privateKey } = await generateKeyPair();
const token = await signToken(
  { iss: 'me', aud: 'peer', iat: now, exp: now + 300, jti: crypto.randomUUID(), cat: 'email-validation', cpct: 5 },
  privateKey,
  'me',
);

// Target: verify a presented token against the referrer's registry pubkey.
const result = await verifyToken(token, {
  audience: 'peer',
  resolvePublicKey: async (kid) => fetchPublicKeyFromRegistry(kid),
});
```

The full drop-in middleware, payout router, and CLI are published as the npm
package [`x402-mesh`](https://www.npmjs.com/package/x402-mesh). This folder is
the minimum you need to participate by hand.
