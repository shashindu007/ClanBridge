// T2.3 — The Clash of Clans API client. R1: only scripts/sync/ may call this.
// 
//   - base URL from COC_API_BASE
//   - 10 second timeout via AbortController
//   - retry with backoff on 429 and 5xx ONLY — never on 403 or 404, which are
//     configuration errors that retrying cannot fix
//   - 200 ms delay between calls
//   - every response parsed through the Zod schemas in coc-schemas.ts
//   - USE_FIXTURES=true reads fixtures/ instead of the network
// 
// Done when the whole client works offline with USE_FIXTURES=true.

export {};
