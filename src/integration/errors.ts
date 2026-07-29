// Named error classes (section 4 — never throw bare strings).
// 
// CocAuthError       403. The key IP does not match. Home IP changed, or a VPN.
// CocNotFoundError   404. Usually a tag that was not %23-encoded.
// CocRateLimitError  429. Retryable with backoff.
// CocPrivateLogError war log is private (T0.1). The war module cannot work at all.
// 
// R8 — no error message, cause, or stack may ever contain a player API token.

export {};
