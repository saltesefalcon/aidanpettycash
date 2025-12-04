import { getAuth } from "firebase/auth";
import "@/lib/firebase";

export async function getIdTokenOrThrow() {
  const auth = getAuth();
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  // forceRefresh=true so a stale token can’t cause a 401
  return await u.getIdToken(true);
}
