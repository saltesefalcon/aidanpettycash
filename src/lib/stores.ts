// src/lib/stores.ts
export type StoreId = 'beacon' | 'tulia' | 'prohibition' | 'cesoir';

export const STORE_INFO: Record<StoreId, { name: string; accountingTo: string }> = {
  beacon:      { name: 'Beacon Social House',       accountingTo: 'accounts@beaconsocialhouse.com' },
  tulia:       { name: 'Tulia Osteria',             accountingTo: 'accounts@tuliaosteria.com' },
  prohibition: { name: 'Prohibition Social House',  accountingTo: 'accounts@prohibitionsocialhouse.com' },
  cesoir:      { name: 'Ce Soir Brasserie & Bar',   accountingTo: 'accounts@cesoirbrasserie.com' },
};
