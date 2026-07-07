import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyDaDRpUyUGtQcpb7EOa3kyOECLJOx3c9Lk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'flexspace-1.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'flexspace-1',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'flexspace-1.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '544136326567',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:544136326567:web:eeab9a468ce0f82299da82',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? 'G-LVT5RRD31W',
};

export const app = initializeApp(firebaseConfig);
export const analyticsPromise = isSupported().then((supported) => (supported ? getAnalytics(app) : null));
export const auth = getAuth(app);
export const db = getFirestore(app);
