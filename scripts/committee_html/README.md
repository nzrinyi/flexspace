# Optional committee HTML overrides

GitHub Actions may be unable to reach the Senate committee pages even when the
Senate roster AJAX endpoint works. When that happens, save a small public HTML
snippet for each committee here and the SenStats ingestion job will parse these
files before trying the network.

You do **not** need to paste or commit the entire 1,000-line page response.
For each committee, save only the block that contains the member cards, starting
around:

```html
<div class="row sc-committee-members">
```

and ending after the corresponding `.sc-committee-members-dynamic-content-list`
member-card rows. The parser only needs the repeated
`.sc-committee-members-dynamic-content-member-card` blocks plus their nearby
role/name/party text.

Accepted filenames for AEFA are:

- `aefa.html`
- `aefa.snippet.html`
- `aefa.txt`

Use the same lowercase committee code for the other committees (`agfo.html`,
`aovs.html`, etc.). The snippet can come from either the rendered committee page
or the `GetCommitteeMembership` response body. These files contain public Senate
data only and can be committed when needed.
