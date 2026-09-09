/**
 * THE standardized query. One document, executed unchanged against every
 * deployment in the registry.
 *
 * This constant is the standards-leverage claim in concrete form: adding a
 * 26th lending protocol is one row in the registry and zero lines of query
 * code, because Messari's schema is the same shape everywhere. Without a
 * shared schema this file would be 25 bespoke documents.
 *
 * Deliberately names no protocol — if it did, it would not be standardized.
 */
export const LENDING_MARKETS_QUERY = `{
  markets(
    first: 250
    where: { isActive: true }
    orderBy: totalDepositBalanceUSD
    orderDirection: desc
  ) {
    id
    name
    inputToken { id symbol decimals }
    totalDepositBalanceUSD
    totalBorrowBalanceUSD
    rates { rate side type }
  }
}`;
