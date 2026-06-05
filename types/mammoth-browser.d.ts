// mammoth ships a prebuilt browser bundle but no types for the subpath. We only
// use extractRawText, so declare the slice we touch.
declare module "mammoth/mammoth.browser" {
  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string; messages: unknown[] }>;
  const _default: { extractRawText: typeof extractRawText };
  export default _default;
}
