/**
 * Triggers the browser's print dialog. The actual "PDF look" is controlled by
 * the `@media print` block in `app/globals.css`, which hides everything except
 * the element marked with the class `canvas-ai-print-target`.
 *
 * Pattern: set document.title to the doc title so Chrome's "Save as PDF"
 * suggests a sensible filename, print, then restore the title.
 */
export function printDocument(title: string): void {
  const previousTitle = document.title;
  const printTitle = title.trim().length > 0 ? title.trim() : "document";
  document.title = printTitle;
  try {
    window.print();
  } finally {
    document.title = previousTitle;
  }
}
