/**
 * BSV Payment Channel Types
 *
 * Payment channels enable off-chain micropayments between two parties.
 * Only the opening and closing transactions go on-chain.
 */
export const DEFAULT_CHANNEL_CONFIG = {
    defaultLifetimeMs: 60 * 60 * 1000, // 1 hour
    minCapacity: 1000, // 1000 sats
    maxCapacity: 100_000_000, // 1 BSV
    feeRate: 1 // 1 sat/byte
};
