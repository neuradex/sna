"use client";

import { useMemo } from "react";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

const MARKDOWN_STYLES = `
.sna-md { color: var(--sna-text-secondary); line-height: 1.6; word-break: break-word; }
.sna-md h1,.sna-md h2,.sna-md h3 { color: var(--sna-text); margin: 12px 0 6px; font-size: inherit; }
.sna-md h1 { font-size: 1.15em; }
.sna-md h2 { font-size: 1.1em; }
.sna-md h3 { font-size: 1.05em; }
.sna-md p { margin: 4px 0; }
.sna-md ul,.sna-md ol { margin: 4px 0; padding-left: 20px; }
.sna-md li { margin: 2px 0; }
.sna-md code {
  font-family: var(--sna-font-mono);
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.9em;
}
.sna-md pre {
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--sna-radius-md);
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.sna-md pre code { background: none; border: none; padding: 0; font-size: 12px; }
.sna-md table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  font-size: 13px;
}
.sna-md th,.sna-md td {
  border: 1px solid var(--sna-surface-border);
  padding: 6px 10px;
  text-align: left;
}
.sna-md th { background: var(--sna-surface); color: var(--sna-text); font-weight: 600; }
.sna-md blockquote {
  border-left: 3px solid var(--sna-accent);
  margin: 8px 0;
  padding: 4px 12px;
  color: var(--sna-text-muted);
}
.sna-md a { color: var(--sna-accent); text-decoration: none; }
.sna-md a:hover { text-decoration: underline; }
.sna-md strong { color: var(--sna-text); }
.sna-md hr { border: none; border-top: 1px solid var(--sna-surface-border); margin: 12px 0; }
`;

let stylesInjected = false;
function injectMarkdownStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.id = "sna-markdown-styles";
  style.textContent = MARKDOWN_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

interface MarkdownContentProps {
  text: string;
}

export function MarkdownContent({ text }: MarkdownContentProps) {
  injectMarkdownStyles();
  const html = useMemo(() => marked.parse(text) as string, [text]);
  return <div className="sna-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
