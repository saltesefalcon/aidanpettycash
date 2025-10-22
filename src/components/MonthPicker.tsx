"use client";

type Props = {
  /** Current month in YYYY-MM, e.g. "2025-10" */
  value: string;
  /** Called with YYYY-MM when month or year changes */
  onChange: (m: string) => void;
  yearStart?: number;
  yearEnd?: number;
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function MonthPicker({ value, onChange, yearStart, yearEnd }: Props) {
  const now = new Date();
  const [yy, mm] = value.split("-").map(Number);
  const y = Number.isFinite(yy) ? yy : now.getFullYear();
  const m = Number.isFinite(mm) ? mm : now.getMonth() + 1;

  const start = yearStart ?? now.getFullYear() - 5;
  const end   = yearEnd   ?? now.getFullYear() + 2;

  const fmt = (ny: number, nm: number) => `${ny}-${String(nm).padStart(2, "0")}`;
  const setMonth = (nm: number) => onChange(fmt(y, nm));
  const setYear  = (ny: number) => onChange(fmt(ny, m));

  const prev = () => { const d = new Date(y, m - 2, 1); onChange(fmt(d.getFullYear(), d.getMonth() + 1)); };
  const next = () => { const d = new Date(y, m, 1);     onChange(fmt(d.getFullYear(), d.getMonth() + 1)); };

  const btn = "rounded-md border px-2 py-1 text-sm hover:bg-gray-50";

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={prev} className={btn} aria-label="Previous month">‹</button>

      {/* Native month select; pad-right leaves space for the browser’s own arrow */}
      <select
        className="rounded-md border bg-white px-3 pr-8 py-1.5 text-sm text-center"
        value={m}
        onChange={(e) => setMonth(parseInt(e.target.value, 10))}
      >
        {MONTHS.map((label, idx) => (
          <option key={label} value={idx + 1}>{label}</option>
        ))}
      </select>

      {/* Native year select */}
      <select
        className="rounded-md border bg-white px-3 pr-8 py-1.5 text-sm text-center"
        value={y}
        onChange={(e) => setYear(parseInt(e.target.value, 10))}
      >
        {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((yr) => (
          <option key={yr} value={yr}>{yr}</option>
        ))}
      </select>

      <button type="button" onClick={next} className={btn} aria-label="Next month">›</button>
    </div>
  );
}


