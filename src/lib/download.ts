/** Start a browser download for a same-origin URL without navigating away. */
export function downloadFromUrl(url: string, fileName?: string) {
  const link = document.createElement("a");
  link.href = url;
  if (fileName) link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
