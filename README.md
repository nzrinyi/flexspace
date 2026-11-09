# Flexspace

Flexspace contains CarMatch and FlowBudget. Use the visible app menu to switch workspaces.

## CarMatch

CarMatch is a shared decision-making prototype for paired partners comparing family vehicles with live Firebase synchronization.


## App features

- Expanded Canadian-market model browser with body style, drivetrain, powertrain, search, actual/quote price display, max-price, monthly-budget, lifecycle-stage, seat-count, AWD, hybrid, and car-seat-tested filters.
- Real-time dashboard ranking models by combined Emily/Nick priorities, confidence, deal, and test-drive signals.
- Emily/Nick profile switcher with Firestore-persisted priority weights, favourite vehicle stars, reactions, and shared notes.
- Sticky compare tray with clear/compare actions, mini thumbnails, four-vehicle limit messaging, and drag/reorder controls for side-by-side finalist comparison.
- Model profiles with manufacturer source links, photo credits, specs, highlights, shared notes, ownership estimates, reactions, and watch-outs.
- Payment calculator split into Simple, Realistic, and Ownership modes with inline field tooltips, editable costs, and budget guardrails.
- Deal tracker for dealer quotes, trims, discounts, fees, accessories, trade-in, rates, quote expiry, contacts, listing URLs, and used-vehicle inspection details.
- Test-drive timeline grouped by vehicle with dealer/date headers, checklist progress rings, photo URL slots, planned/completed status, reminders, and comparison chips.
- Local UI filters, active section, and compare selections persist in localStorage.

## Manufacturer research sources

The static model profiles use manufacturer model pages as source links. Vehicle imagery uses stable Wikimedia Commons file URLs for actual vehicle photos, with each model retaining its manufacturer source link separately.

## Firebase project

This codebase is configured for the existing Firebase project `flexspace-1` / project number `544136326567` via `.firebaserc`.

## Register the Firebase web app

Use Firebase CLI credentials that have owner/editor access to the project:

```bash
firebase login
firebase apps:list --project flexspace-1
firebase apps:sdkconfig WEB 1:544136326567:web:eeab9a468ce0f82299da82 --project flexspace-1
```

The Firebase web app config has been added to `.env.example`; copy it to `.env.local` for local development. Vite exposes only variables prefixed with `VITE_` to the browser bundle.

## Local development

```bash
npm install
npm run dev
```

## Build and deploy to Firebase Hosting

```bash
npm run build
firebase deploy --only hosting --project flexspace-1
```

Firebase Hosting is configured to serve `dist` and rewrite all routes, including `/join?session=...`, to `index.html` so invite links work as a single-page application.

## Firestore rules deployment

Firestore rules are defined in `firestore.rules` and referenced from `firebase.json`. Deploy them from an account with Firebase rules and Service Usage permissions:

```bash
npm run deploy:rules
```

The GitHub Hosting workflow intentionally does not deploy Firestore rules because the current `FIREBASE_SERVICE_ACCOUNT` secret can deploy Hosting but received `403 Permission denied to get service [firestore.googleapis.com]` during the Firebase CLI Service Usage check. To deploy rules from CI later, grant that service account the required Firebase Rules/Firestore permissions plus Service Usage Viewer, then add a separate rules deploy step back to the workflow.


## Firebase console prerequisites

Before the deployed site can create paired sessions, enable Firebase Authentication for the `flexspace-1` project and turn on the **Anonymous** sign-in provider:

1. Open Firebase Console for `flexspace-1`.
2. Go to **Authentication** > **Sign-in method**.
3. Enable **Anonymous** as a provider.
4. Confirm Firestore is created for the same project.

If Anonymous Auth is not enabled, the deployed app will show `auth/configuration-not-found` when it tries to start a guest session.

## GitHub deployment

GitHub Actions deploys every pushed branch to the live Firebase Hosting site using `.github/workflows/firebase-hosting.yml`. Add these repository secrets before relying on automatic deployment:

- `FIREBASE_SERVICE_ACCOUNT`: JSON service account credentials with permission to deploy Firebase Hosting for `flexspace-1`. Firestore rules deployment is kept as a separate manual command until this service account also has the required Firestore rules and Service Usage permissions.

The deployed site will be available at:

- `https://flexspace-1.web.app`
- `https://flexspace-1.firebaseapp.com`

## Development checks and decision workflow

Use Node 24 (`nvm use`) and `npm ci`. Dependencies are locked in `package-lock.json`.

```bash
npm test                 # Finance, evidence, readiness, and calendar regressions
npm run build            # TypeScript and production bundle
npx playwright install chromium
npm run test:browser     # Desktop and mobile flows with an isolated Firebase fixture
```

Browser tests use a separate Vite configuration on port 5174 and an in-memory Firebase adapter. They never authenticate to or write to the live Firebase project. They cover the UI and failure recovery; they do not validate deployed Firestore rules or backend availability. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing browser. The normal `npm run dev` workflow continues to use the real backend.

Emily/Nick selection and the existing honour-system permissions are unchanged. The session URL can be copied from the header and saved for another device; the current browser also remembers its last session. Existing Firebase session membership limits still apply. No new account or household authorization flow is introduced.

The Home screen highlights the shortlist, upcoming drives, expiring offers, shared favourites, and reviews to discuss. Open the priorities disclosure to adjust the shared weights. Vehicle details open independently of the comparison tray. Comparison supports differences-only and a two-vehicle view.

Purchase scenarios use raw vehicle prices, add fees/tax once, then apply trade-in and cash down. Total monthly ownership includes the loan, estimated energy, insurance, and maintenance everywhere a monthly budget is used. Household assumptions and each vehicle's selected price source are stored on this device, as are named scenario snapshots. Quotes and diary records remain shared through Firestore. Expired and archived quotes are excluded from automatic offer selection and evidence. The tax model assumes an Ontario-style dealer trade-in tax credit; verify local taxes with the dealer. Loan comparisons use the household APR unless you explicitly apply an offered rate. Catalogue energy estimates are approximate; enter consumption and annual kilometres in Ownership mode. PHEVs default to gasoline operation.

Only completed, nonarchived drives contribute ratings. Unrated profiles stay unreviewed; older entries retain their legacy partner rating. Unknown car-seat fit and equipment generate verification tasks, while explicit failures and the deal-breaker control can block readiness. Free-text notes never reject a vehicle. Catalogue prices, scores, and equipment remain planning estimates; unrecorded verification dates are displayed honestly, and manufacturer links are provided.

Quotes and drives can be edited, archived, and restored. Forms retain their draft when a save fails. Drive photos (JPG, PNG, WebP) are resized in the browser and saved directly with the diary record, up to three compressed images; no separate Storage credentials are required. Calendar export includes appointment and optional reminders. CarMatch itself does not send reminder notifications.

“Needs review” actions open the named profile's reaction control. Vehicle details link directly to a new quote or planned drive with that vehicle preselected. Recommendations within three points are presented as “Similar fit” in groups anchored to their highest score, without chaining distant scores together. This is a planning heuristic, not statistical confidence; compare trade-offs and real quotes. Exact planning scores remain available in the vehicle details disclosure.


## FlowBudget

Open `/?app=budget` or choose FlowBudget in the app launcher. FlowBudget works independently of CarMatch’s Firebase sign-in and stores its data in the current browser. No banking login, bank feed, or cross-device synchronization is configured. Export JSON backups before switching devices or clearing browser data.

Features include manual accounts and transactions, transfers, statement-cleared status, mapped CSV import with preview/duplicate detection, spending categories and income targets, monthly plans, recurring bills/paychecks, a daily cash-flow forecast, account filtering, reserve planning, reports, editable records and undo.

Checking, savings, cash and credit-card accounts can be included in the combined cash-flow forecast. Investment accounts and accounts explicitly marked “tracked only” are excluded from combined spending cash; they remain part of total tracked balances. Transfers into excluded savings/investment accounts reduce available cash without being treated as expenses. Credit-card debt is entered as a negative balance. Account values are manually entered snapshots; investment gains are not predicted.

Recurring schedules anchor to their original date. Monthly dates clamp to shorter months without drifting. Optional posting adjustments support weekdays or Canadian/Ontario bank business days. Actual institution posting dates can vary. Unrecorded overdue items apply to today’s forecast, while a matched recorded payment suppresses that occurrence. Category limits are not automatically projected as spending: forecasts include recorded future transactions and active recurring items only.

Monthly income targets and expense plans represent a regular month; actual biweekly cash flow follows the calendar, including three-payment months. Items with unconfirmed dates stay paused, and unconfirmed account balances do not produce a numerical forecast.

CSV imports require a header and mapped Date, Description, and signed Amount, or separate Debit/Credit columns. Dates support ISO, month/day/year and day/month/year. Positive signed amounts are income; negative amounts are expenses. Unknown categories go to Other when available. Review imported transfers and match recurring payments after import. CSV exports are ledger reports; JSON backups are the complete round-trip format.

Private setup links use compressed URL fragments. Their data is consumed and removed from the URL locally. On an empty device the plan is saved immediately; replacing an existing budget requires confirmation. Household presets must never be committed to this public repository or included in public build assets. Automatic analytics initialization is disabled. The app checks backup schemas, protects drafts on storage failures, and receives changes from other tabs without discarding an open transaction draft.

Run `npm test` for calculation, recurrence, transfer, business-day, CSV and schema regressions. Run `npm run test:browser` for both the budgeting and vehicle workflows at desktop/mobile sizes, including persistence, backups, failed writes, multiple tabs and private setup links. Browser fixtures never contact the production backend.
