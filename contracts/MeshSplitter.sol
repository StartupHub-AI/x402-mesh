// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MeshSplitter
/// @notice Atomic two-way USDC split for x402-mesh referred payments on Base.
///         Pulls `amount` USDC from the payer and forwards it to the vendor
///         and referrer in a single transaction. Non-custodial: holds no
///         balance, has no owner, cannot be upgraded or paused.
/// @dev    The payer (agent) must `approve` this contract for `amount` USDC
///         first (standard ERC-20 allowance), then call `pay`. The contract
///         never holds funds between calls, so there is nothing to steal and
///         no privileged role to compromise. Audit once, trust forever.
contract MeshSplitter {
    /// @dev Base mainnet USDC. Set once at deploy, immutable.
    IERC20 public immutable usdc;

    /// @notice Emitted on every settled referred payment. The off-chain
    ///         settle endpoint reads this to reconcile against the mesh
    ///         ledger. `jti` is the referral token id, byte-packed (see
    ///         jtiToBytes32 in lib/x402-mesh/payouts/usdc-base.ts).
    event MeshPaid(
        bytes32 indexed jti,
        address indexed vendor,
        address indexed referrer,
        uint256 vendorAmount,
        uint256 referrerAmount
    );

    error CommissionTooHigh();
    error TransferFailed();

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    /// @param jti           the referral JWT id, byte-packed into bytes32
    /// @param vendor        target vendor wallet (receives gross − commission)
    /// @param referrer      referring vendor wallet (receives commission)
    /// @param amount        gross USDC in 6-decimal micro-units
    /// @param commissionBps commission in basis points (e.g. 500 = 5%)
    function pay(
        bytes32 jti,
        address vendor,
        address referrer,
        uint256 amount,
        uint16 commissionBps
    ) external {
        if (commissionBps > 10_000) revert CommissionTooHigh();

        uint256 referrerAmount = (amount * commissionBps) / 10_000;
        uint256 vendorAmount = amount - referrerAmount;

        // Pull once, forward twice, in the same transaction. The contract
        // balance is always zero between calls.
        if (!usdc.transferFrom(msg.sender, vendor, vendorAmount)) revert TransferFailed();
        if (referrerAmount > 0) {
            if (!usdc.transferFrom(msg.sender, referrer, referrerAmount)) revert TransferFailed();
        }

        emit MeshPaid(jti, vendor, referrer, vendorAmount, referrerAmount);
    }
}
