"use client";
type Props = { storeId: string; active?: "dashboard"|"entries"|"admin"|"qbo"|"settings" };

export default function MobileNav({ storeId, active }: Props) {
  const Item = (p: { href: string; id: Props["active"]; label: string }) => (
    <a
      href={p.href}
      className={
        "px-3 py-2 rounded border text-sm whitespace-nowrap " +
        (active === p.id ? "bg-gray-100 font-semibold" : "")
      }
    >
      {p.label}
    </a>
  );

  return (
    <nav className="md:hidden flex gap-2 overflow-x-auto mt-2">
      <Item href={`/store/${storeId}/dashboard`} id="dashboard" label="Dashboard" />
      <Item href={`/store/${storeId}/entries`}    id="entries"   label="Entries" />
      <Item href={`/store/${storeId}/admin`}      id="admin"     label="Admin" />
      <Item href={`/store/${storeId}/qbo-export`} id="qbo"       label="QBO Export" />
      <Item href={`/store/${storeId}/settings`}   id="settings"  label="Settings" />
    </nav>
  );
}
