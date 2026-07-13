import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyCp1HdSHYQXE-yY8ga6alvLv2gka2d9Ltw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'quorum-2.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'quorum-2',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'quorum-2.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '594173636153',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:594173636153:web:cf3c1d2aadde06508167e8',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? 'G-PLLC7GDQMM',
};

export const app = initializeApp(firebaseConfig);
export const analyticsPromise = isSupported().then((supported) => (supported ? getAnalytics(app) : null));
export const auth = getAuth(app);
export const db = getFirestore(app);
