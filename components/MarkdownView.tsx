"use client";

import {
  useMemo,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
} from "react";
import ReactMarkdown, { type ExtraProps, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { markdownUrlTransform } from "@/lib/markdown/urlTransform";
import { renderLatex } from "@/lib/markdown/renderLatex";

// `$$...$$` display math only, matching the editor. Single-dollar inline math
// is off so "$3,200 vs $2,963" stays prose.
const remarkPlugins: Options["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];

// Links always open in a new tab so a click never navigates away from the app.
function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noreferrer" />;
}

// remark-math emits `<pre><code class="math-display">` (and `<code
// class="math-inline">` for an inline `$$x$$`). Typeset them here through the
// cached renderer instead of rehype-katex, which re-typeset every equation on
// every render.
type HastNode = { type: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] };

function mathClass(node: HastNode | undefined): "math-display" | "math-inline" | null {
  const cls = node?.properties?.className;
  if (!Array.isArray(cls)) return null;
  if (cls.includes("math-display")) return "math-display";
  if (cls.includes("math-inline")) return "math-inline";
  return null;
}

function nodeText(node: HastNode | undefined): string {
  return node?.children?.map((c) => c.value ?? nodeText(c)).join("") ?? "";
}

function Pre({ node, ...rest }: HTMLAttributes<HTMLPreElement> & ExtraProps) {
  const code = (node as HastNode | undefined)?.children?.[0];
  if (mathClass(code) === "math-display") {
    return <div dangerouslySetInnerHTML={{ __html: renderLatex(nodeText(code), true) }} />;
  }
  return <pre {...rest} />;
}

function Code({ node, ...rest }: HTMLAttributes<HTMLElement> & ExtraProps) {
  if (mathClass(node as HastNode | undefined) === "math-inline") {
    return <span dangerouslySetInnerHTML={{ __html: renderLatex(nodeText(node as HastNode), false) }} />;
  }
  return <code {...rest} />;
}

// An image pasted or dropped into a document is stored inline as a data URL,
// often hundreds of KB each. Parsing those through remark on every render
// froze the page for seconds per autosave, so swap each one for a short
// fragment ref before parsing and put the real src back when rendering <img>.
const INLINE_IMAGE_SRC = /(!\[[^\]]*\]\()(data:image\/[^)\s]+)/g;
const STUB_PREFIX = "#inline-image-";

function stubInlineImages(markdown: string): { markdown: string; srcs: string[] } {
  const srcs: string[] = [];
  const stubbed = markdown.replace(INLINE_IMAGE_SRC, (_m, head: string, src: string) => {
    srcs.push(src);
    return `${head}${STUB_PREFIX}${srcs.length - 1}`;
  });
  return { markdown: stubbed, srcs };
}

/**
 * Shared markdown renderer: GitHub-flavored markdown, display math, the safe
 * URL transform, and new-tab links. Wrap it in a `canvas-ai-prose` div (or
 * similar) at the call site for typography.
 */
export function MarkdownView({ children }: { children: string }) {
  const { markdown, components } = useMemo(() => {
    const { markdown, srcs } = stubInlineImages(children);
    const img = ({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement>) => {
      const real =
        typeof src === "string" && src.startsWith(STUB_PREFIX)
          ? srcs[Number(src.slice(STUB_PREFIX.length))]
          : src;
      // eslint-disable-next-line @next/next/no-img-element
      return <img {...rest} src={real} alt={alt ?? ""} />;
    };
    return { markdown, components: { a: Link, img, pre: Pre, code: Code } };
  }, [children]);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={components}
      urlTransform={markdownUrlTransform}
    >
      {markdown}
    </ReactMarkdown>
  );
}
