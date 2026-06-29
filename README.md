# Co-Pilot

Co-Pilot is a shared decision-making prototype for paired partners comparing family vehicles with live Firebase synchronization.

## Firebase project

This codebase is configured for the existing Firebase project identifier `544136326567` via `.firebaserc`.

## Register the Firebase web app

Use Firebase CLI credentials that have owner/editor access to the project:

```bash
firebase login
firebase apps:create WEB "Co-Pilot Web" --project 544136326567
firebase apps:sdkconfig WEB <APP_ID_FROM_CREATE_OUTPUT> --project 544136326567
```

Copy the SDK config values into `.env.local` using `.env.example` as the template. Vite exposes only variables prefixed with `VITE_` to the browser bundle.

## Local development

```bash
npm install
npm run dev
```

## Build and deploy to Firebase Hosting

```bash
npm run build
firebase deploy --only hosting --project 544136326567
```

Firebase Hosting is configured to serve `dist` and rewrite all routes, including `/join?session=...`, to `index.html` so invite links work as a single-page application.
