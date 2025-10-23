// Thin shim to keep the legacy /api/store/:id/qbo-export URL working.
// It reuses the real handler you edited in /export/qbo/route.ts.

export { GET } from '../export/qbo/route';
export { runtime, dynamic } from '../export/qbo/route';




