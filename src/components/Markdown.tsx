import { Fragment, type ReactNode } from "react";

import { Copyable } from "./Copyable";

/**
 * A deliberately small markdown subset: fenced code, inline code, bold, italic
 * and links. It renders to React elements and never to raw HTML, so nothing a
 * step body contains can inject markup — the text comes from an agent, and an
 * agent can be talked into writing anything.
 */

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      const safe = /^https?:\/\//i.test(href) ? href : undefined;
      nodes.push(
        safe ? (
          <a key={key} href={safe} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  let fence: { lang: string; lines: string[] } | null = null;

  const flush = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    if (text) blocks.push(<p key={`p${blocks.length}`}>{inline(text, `p${blocks.length}`)}</p>);
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith("```")) {
        blocks.push(<Copyable key={`c${blocks.length}`} value={fence.lines.join("\n")} block />);
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      flush();
      fence = { lang: trimmed.slice(3).trim(), lines: [] };
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    paragraph.push(trimmed);
  }
  // An unclosed fence is still content the user needs to see.
  if (fence) blocks.push(<Copyable key={`c${blocks.length}`} value={fence.lines.join("\n")} block />);
  flush();

  return <>{blocks}</>;
}
