function escapeCell(value: unknown) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function rowsToCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(','))].join('\n');
}

export function csvBlob(rows: Record<string, unknown>[]) {
  return new Blob([`\uFEFF${rowsToCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
}

/** Share a report file when the device allows it, otherwise open WhatsApp with the summary. */
export async function shareReport(options: {
  title: string;
  text: string;
  filename: string;
  rows?: Record<string, unknown>[];
  blob?: Blob;
}): Promise<'shared' | 'whatsapp' | 'copied'> {
  const blob = options.blob ?? (options.rows && options.rows.length > 0 ? csvBlob(options.rows) : null);
  const file = blob ? new File([blob], options.filename, { type: blob.type || 'text/csv' }) : null;
  const payload = { title: options.title, text: options.text, ...(file ? { files: [file] } : {}) };
  if (navigator.share) {
    const canFiles = file ? navigator.canShare?.({ files: [file] }) : false;
    try {
      await navigator.share(canFiles ? payload : { title: options.title, text: options.text });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }
  const message = `${options.title}\n\n${options.text}`;
  try {
    await navigator.clipboard.writeText(message);
  } catch {
    /* clipboard can be blocked in an embedded preview */
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  return 'whatsapp';
}
