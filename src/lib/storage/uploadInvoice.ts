'use client';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase';

export async function uploadInvoicePdf({
  storeId, entryId, pdfBlob, filename = 'invoice.pdf'
}: { storeId: string; entryId: string; pdfBlob: Blob; filename?: string; }) {
  const path = `pettycash/${storeId}/${entryId}/${filename}`;
  const sref = ref(storage, path);
  await uploadBytes(sref, pdfBlob, { contentType: 'application/pdf' });
  const url = await getDownloadURL(sref);
  return { url, path };
}
