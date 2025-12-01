// src/lib/admin.ts
import admin from "firebase-admin";

declare global {
  // allow global across hot-reloads in dev
  // eslint-disable-next-line no-var
  var __ADMIN_APP__: admin.app.App | undefined;
}

function init() {
  if (admin.apps.length) return admin.app();

  // Option A: full JSON in env (FIREBASE_SERVICE_ACCOUNT_JSON)
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const sa = JSON.parse(saJson);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    return admin.initializeApp({
      credential: admin.credential.cert(sa),
      storageBucket:
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
        process.env.FIREBASE_STORAGE_BUCKET,
    });
  }

  // Option B: split env vars (recommended for Windows)
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing admin env. Provide FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY."
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      process.env.FIREBASE_STORAGE_BUCKET,
  });
}

export function getAdminApp() {
  if (!globalThis.__ADMIN_APP__) {
    globalThis.__ADMIN_APP__ = init();
  }
  return globalThis.__ADMIN_APP__;
}

export const getAdminDb = () => getAdminApp().firestore();
export const getAdminBucket = () => getAdminApp().storage().bucket();
