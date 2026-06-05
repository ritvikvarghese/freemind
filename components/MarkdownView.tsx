"use client";

import type { AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrlTransform } from "@/lib/markdown/urlTransform";

// Links always open in a new tab so a click never navigates away from the app.
const components = {
  a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} target="_blank" rel="noreferrer" />
  ),
};

/**
 * Shared markdown renderer: GitHub-flavored markdown, the safe URL transform,
 * and new-tab links. Wrap it in a `canvas-ai-prose` div (or similar) at the
 * call site for typography.
 */
export function MarkdownView({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
      urlTransform={markdownUrlTransform}
    >
      {children}
    </ReactMarkdown>
  );
}
