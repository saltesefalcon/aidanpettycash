// src/lib/firebaseAdmin.ts
import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let app: App;

if (!getApps().length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing FIREBASE_* server envs. Check .env.local");
  }

  // Convert escaped newlines; strip accidental wrapping quotes if present
  privateKey = privateKey.replace(/\\n/g, "\n").replace(/^"+|"+$/g, "");

  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
} else {
  app = getApps()[0]!;
}

export const adminApp = app;
export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);

