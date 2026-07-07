# CarMatch

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

## SenStats daily data sync

SenStats data ingestion runs from `.github/workflows/senstats-data-sync.yml` and calls `scripts/senstats_ingest.py` automatically every day at 09:17 UTC, or manually through GitHub Actions workflow dispatch once the workflow is on the default branch.

Required secrets/environment values:

- `FIREBASE_SERVICE_ACCOUNT`: Firebase service-account JSON used by the Python Admin SDK. The script also accepts `GOOGLE_APPLICATION_CREDENTIALS_JSON` or `FIREBASE_SERVICE_ACCOUNT_JSON` when running locally.
- `SENSTATS_CONTACT_EMAIL`: Contact email included in the scraper User-Agent, e.g. `SenStats-Data-Sync/1.0 (Contact: you@example.com)`.

The pipeline first tries Open North Represent for senator metadata, falls back to the official Senate current-senators AJAX endpoint when Represent has no Senate records, and writes senator master records to `/senstats_senators/{senatorId}` plus quarterly expense records to `/senstats_senators/{senatorId}/expenses/{expenseId}`. Failed requests, parsing issues, and suspected HTML structure changes are logged to `senstats_ingest_errors.log` and uploaded as a workflow artifact.
