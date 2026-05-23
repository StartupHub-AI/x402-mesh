# MeshSplitter — deploy & wire-up

Atomic USDC commission split for x402-mesh referred payments on Base.
Design rationale and the full settlement-semantics table are in
`docs/x402-mesh-base-splitter.md`. This file is the operational checklist.

The on-chain side is **inert until deployed**. The server-side adapter
(`lib/x402-mesh/payouts/usdc-base.ts`) stays in facilitator-fallback mode
until `X402_MESH_SPLITTER_ADDRESS` is set, so nothing here affects
production before you deploy.

## Constructor arg — USDC on Base

| Network | USDC address |
|---|---|
| Base mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia (testnet) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Deploy (Foundry)

```bash
# from contracts/
forge create MeshSplitter.sol:MeshSplitter \
  --rpc-url https://sepolia.base.org \
  --private-key $DEPLOYER_PK \
  --constructor-args 0x036CbD53842c5426634e7929541eC2318f3dCF7e \
  --verify --etherscan-api-key $BASESCAN_KEY
```

Swap the RPC URL + USDC address for mainnet when testnet passes.

## Recommended sequence

1. **Slither** — `slither MeshSplitter.sol`. The only external calls are the
   two `transferFrom`s to caller-supplied addresses; expect a clean report.
2. **Testnet deploy** to Base Sepolia. Fund a test agent wallet with testnet
   USDC, register a test vendor + referrer with `0x` wallets, run a full
   `approve` → `pay` → both-wallets flow.
3. **End-to-end check** — confirm the emitted `MeshPaid` log reconciles: call
   `POST /api/x402-mesh/settle` with the tx hash as `payment_proof.ref` and
   verify the payout row flips to `settled`.
4. **Mainnet deploy** with the mainnet USDC arg. Record the address.
5. **Verify on Basescan** so any vendor can read the source before trusting
   it. Link the verified contract from `/docs/x402-mesh`.

## Env after deploy

Set on the Render service (via Render MCP `update_environment_variables`):

```
X402_MESH_SPLITTER_ADDRESS=0x<deployed address>
X402_BASE_RPC_URL=https://mainnet.base.org   # or an Alchemy/Infura Base RPC for higher log-read limits
```

Setting `X402_MESH_SPLITTER_ADDRESS` flips `usdc-base.ts` from facilitator
mode to splitter-verify mode automatically. No code change, no redeploy
beyond the env update.

## Payment-side calldata

The referred-payment 402 advertises the splitter coordinates so the agent
knows how to pay. The `jti` argument MUST be encoded with `jtiToBytes32()`
exported from `lib/x402-mesh/payouts/usdc-base.ts` — same function the
verifier uses. Do not reimplement it.

```
approve(USDC, MeshSplitter, amount)          # standard ERC-20 allowance
MeshSplitter.pay(
  jtiToBytes32(referralJti),                 # bytes32
  vendorWallet,                              # address (the target vendor)
  referrerWallet,                            # address (who gets commission)
  amountMicroUSDC,                           # gross, 6-decimal micro-units
  commissionBps                              # e.g. 500 = 5%
)
```

## Future — gasless variant

`pay()` is approve-based (`transferFrom`), which fits agents that can send a
two-step approve+call. A later `payWithAuthorization()` using USDC's
EIP-3009 `receiveWithAuthorization` would let an agent settle gaslessly with
a single signed message, matching x402's "exact" scheme more closely. Out of
scope for v1; add it as a second entrypoint without changing `pay()`.
