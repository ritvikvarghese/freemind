"use client";

import { Download, Printer } from "lucide-react";
import { downloadMarkdown } from "@/lib/export/toMarkdown";
import { printDocument } from "@/lib/export/toPdf";

type Props = {
  title: string;
  markdown: string;
};

export function ExportButtons({ title, markdown }: Props) {
  return (
    <div className="flex items-center gap-1">
      <ExportButton
        label="Download as Markdown"
        onClick={() => downloadMarkdown(title || "document", markdown)}
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        <span>MD</span>
      </ExportButton>
      <ExportButton
        label="Download as PDF (print)"
        onClick={() => printDocument(title || "document")}
      >
        <Printer className="h-3.5 w-3.5" aria-hidden />
        <span>PDF</span>
      </ExportButton>
    </div>
  );
}

function ExportButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-button border border-hairline bg-elevated px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
    >
      {children}
    </button>
  );
}
