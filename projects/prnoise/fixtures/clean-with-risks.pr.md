## Summary

Add rate-limit header to 429 responses.

## Testing

- [x] Unit tests pass
- Not tested: load test at 10k rps

## Risks

Might mis-count clients behind shared NAT — needs review in prod.

## Open questions

Should we expose Retry-After from upstream?
