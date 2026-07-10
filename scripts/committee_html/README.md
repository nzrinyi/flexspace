# Optional committee HTML overrides

If GitHub Actions cannot reach the Senate committee pages, save each committee
page response here as `<committee-code>.html` (for example `aefa.html`). The
SenStats ingestion job will parse these local files before trying the network.

Use the rendered committee page or the `GetCommitteeMembership` response body;
both should include `.sc-committee-members-dynamic-content-member-card` blocks.
These files contain public Senate data only and can be committed when needed.
