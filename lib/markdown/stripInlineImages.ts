// `![alt](data:image/...;base64,...)`: an image pasted or dropped into a
// document, stored inline in its markdown. Alt text can't contain `]` and a
// data URL can't contain `)`, which keeps the match linear.
const INLINE_IMAGE = /!\[([^\]]*)\]\(data:[^)]*\)/g;

/**
 * Replace inline data-URL images with a short `[image: alt]` marker, for any
 * place document markdown is sent to the model as text. One pasted photo is
 * otherwise hundreds of thousands of characters of base64 noise.
 */
export function stripInlineImages(markdown: string): string {
  return markdown.replace(INLINE_IMAGE, (_m, alt: string) => `[image: ${alt.trim() || "untitled"}]`);
}
