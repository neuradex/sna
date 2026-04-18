/**
 * Embed reference parsing.
 *
 * Blocks reference binary attachments via inline markdown-style refs:
 *   "안녕 이 사진 ![](embed://abc123) 봐줄래?"
 *
 * Parser splits such text into ordered text/embed segments so adapters can
 * materialize them as provider-native content arrays (Claude's
 * {type:"image",source}, Codex's {type:"input_image",image_url}, etc.).
 */

/** A text segment produced by splitting content around embed refs. */
export type Segment =
  | { type: "text"; text: string }
  | { type: "embed"; id: string };

const EMBED_REF_RE = /!\[[^\]]*\]\(embed:\/\/([^)\s]+)\)/g;

/**
 * Split content text into alternating text/embed segments in source order.
 * Empty text segments (e.g. back-to-back refs) are preserved to keep ordering
 * explicit; callers should filter them if they want.
 */
export function splitContentByEmbeds(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  EMBED_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_REF_RE.exec(content)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", text: content.slice(lastIndex, m.index) });
    }
    segments.push({ type: "embed", id: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", text: content.slice(lastIndex) });
  }
  return segments;
}

/** Format an inline embed ref for insertion into content text. */
export function formatEmbedRef(id: string, altText = ""): string {
  return `![${altText}](embed://${id})`;
}

/** Extract all embed ids referenced in a content string. */
export function extractEmbedIds(content: string): string[] {
  const ids: string[] = [];
  EMBED_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_REF_RE.exec(content)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}
