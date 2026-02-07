'use client';

/**
 * DEPRECATED / SAFETY STUB
 *
 * This hook previously auto-signed-out after 10 minutes and on beforeunload.
 * That behavior can cause unexpected signouts during scanner flows and across tabs,
 * leading to Firestore permission-denied errors + lost form inputs.
 *
 * Keep this file as a NO-OP so any old imports won't break builds,
 * and (most importantly) won't sign users out.
 */
export default function useIdleSignout() {
  // intentionally empty
}
