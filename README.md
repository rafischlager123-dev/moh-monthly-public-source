# Automatic public monthly source collection

The full collection run collected seven original government Excel releases and
15,262 unique registry medicine IDs across 153 pages. Every published original,
RSS byte payload and registry page passed independent readback checks.

The collection workflow runs on the 20th, 21st and 22nd of each month at 01:17
UTC. The latter days provide automatic retries while the user's computer is
off. It uses a standard free public GitHub runner and publishes public data in
one commit after validation. It has no Actions artifact/cache upload, larger
runner or paid API. Its temporary GitHub job token writes to this public
repository. No company workbook or Microsoft credentials enter GitHub.

The public pharmacy organization directory supplies original government file
links when the government listing refuses cloud access. Seven historical
releases, publication dates and hashes were verified against the government
listing at setup on 20 October 2026. Previously archived releases are retained.
The directory does not establish a complete current government catalog. The
manifest exposes discoveryCoverageReviewRequired, and missing original dates
remain missing. Public collection does not certify private workbook refresh.

The latest catalog is in public/latest.xml and public/catalog.json. Exact
originals and byte-preserving RSS transport are in public/monthly. Registry
captures use immutable paths under public/runs, sorted by unique medicine ID.

## Manual public source access diagnostic

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
mean a full monthly workbook refresh is working. This diagnostic has no recurrence.
Private processing must be implemented, validated and kept inside Microsoft 365
before a monthly refresh can be enabled.

References:

- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://www.gov.il/he/departments/dynamiccollectors/new-israeli-drugs?skip=0
- https://psi.org.il/he/pharma-rules
