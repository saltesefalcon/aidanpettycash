// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence, // keep session across tabs/reloads
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Init (reuse if already created)
const app = getApps().length
  ? getApp()
  : initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    });

export const auth = getAuth(app);
export const db = getFirestore(app);

// Persist login across the whole app (AuthGate will still sign out on idle/close)
setPersistence(auth, browserLocalPersistence).catch(() => {
  /* ignore persistence failures at startup */
});
