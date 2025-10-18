// src/lib/firebaseAdmin.ts
import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let app: App;
if (!getApps().length) {
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
  // IMPORTANT: in .env.local store the private key with \n escaped; we convert here
  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n");

  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
} else {
  app = getApps()[0]!;
}

export const adminDb = getFirestore(app);
