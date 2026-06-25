function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows: Record<string, unknown>[], headers?: string[]): string {
  if (rows.length === 0) return (headers ?? []).join(",");
  const cols = headers ?? Object.keys(rows[0]);
  const head = cols.map(csvEscape).join(",");
  const body = rows
    .map((r) => cols.map((c) => csvEscape(r[c])).join(","))
    .join("\n");
  return head + "\n" + body;
}

export function download(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[], headers?: string[]) {
  download(filename, toCSV(rows, headers), "text/csv");
}

export function downloadJSON(filename: string, data: unknown) {
  download(filename, JSON.stringify(data, null, 2), "application/json");
}

// Excel-friendly: tab-separated with BOM works flawlessly in Excel/Sheets.
export function downloadExcel(filename: string, rows: Record<string, unknown>[], headers?: string[]) {
  if (rows.length === 0) {
    download(filename, "\ufeff" + (headers ?? []).join("\t"), "text/tab-separated-values");
    return;
  }
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: unknown) =>
    v === null || v === undefined ? "" : String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
  const head = cols.join("\t");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join("\t")).join("\n");
  download(filename, "\ufeff" + head + "\n" + body, "text/tab-separated-values");
}
