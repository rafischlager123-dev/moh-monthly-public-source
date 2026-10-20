# Public monthly source access test

This repository tests unattended access to the exact official Israeli Ministry
of Health monthly new-drug Excel releases. It handles public government data
only. It has no company workbook, Microsoft account, Microsoft credentials,
company pipeline or workbook-processing code.

The manual workflow uses the standard `ubuntu-24.04` GitHub-hosted runner in this
public repository. Standard runners in public repositories are free under
GitHub's current billing rules. It uses no larger runner, Actions artifact
upload, cache, paid API or external browser subscription. The job has a
six-minute timeout and read-only repository permission.

The test uses ordinary Chrome through pinned Microsoft Playwright. It stops on
HTTP 403 or a challenge; it does not use proxies, stealth settings or CAPTCHA
handling. It reads reporting periods from official publication headings,
requires a historical boundary and verifies downloaded XLSX packages and
SHA-256 hashes against seven previously validated releases. One registry page
is tested between version checks. Partial success remains separate in the
report.

Read the public job summary for the result. A successful source test does not
mean a full monthly workbook refresh is working. No recurrence is configured.
Private processing must be implemented, validated and kept inside Microsoft 365
before a monthly refresh can be enabled.

References:

- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://www.gov.il/he/departments/dynamiccollectors/new-israeli-drugs?skip=0
