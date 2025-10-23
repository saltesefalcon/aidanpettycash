// Thin shim to keep the legacy /api/store/:id/qbo-export URL working.
// It reuses the real handler you edited in /export/qbo/route.ts.

export { GET } from '../qbo-export/route';
export { runtime, dynamic } from '../qbo-export/route';



