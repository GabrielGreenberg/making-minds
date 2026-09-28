// Trigger a browser download of a file built in the page. Kept separate from
// the storage seams (which stay DOM-free) so the menu bar, Home cards and the
// Grading tab's export (task 071) can reuse it.

/** Download `text` as `filename` (a Blob behind a throwaway link). */
export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked after the click has been handed off (an immediate revoke can
  // cancel the download in some browsers).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}
