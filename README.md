# CarMatch

CarMatch is a shared decision-making prototype for paired partners comparing family vehicles with live Firebase synchronization.


## App features

- Expanded Canadian-market model browser with body style, drivetrain, powertrain, search, and max-price filters.
- Model profile cards with MSRP, cargo, seating, drivetrain, efficiency, highlights, tradeoffs, and manufacturer source links.
- Emily/Nick profile switcher with Firestore-persisted priority weights and favourite vehicle stars that combine into the shared vehicle score.
- Expanded priority criteria for space, winter traction, value, reliability, fuel efficiency, safety tech, and comfort.
- Payment calculator with editable vehicle price, fees, tax rate, interest rate, term, down payment, and extra lump-sum principal payment.
- Test drive diary for car-seat fit, stroller fit, winter confidence, partner rating, dealer/location, and notes.

## Manufacturer research sources

The static model profiles use manufacturer model pages as source links. Vehicle imagery is stored in `public/vehicles` and served by Firebase Hosting at `/vehicles/{model}.svg`, avoiding third-party hotlink failures or disappearing remote image URLs.

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
