const EMBED_REF_RE = /!\[[^\]]*\]\(embed:\/\/([^)\s]+)\)/g;
function splitContentByEmbeds(content) {
  const segments = [];
  let lastIndex = 0;
  EMBED_REF_RE.lastIndex = 0;
  let m;
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
function formatEmbedRef(id, altText = "") {
  return `![${altText}](embed://${id})`;
}
function extractEmbedIds(content) {
  const ids = [];
  EMBED_REF_RE.lastIndex = 0;
  let m;
  while ((m = EMBED_REF_RE.exec(content)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}
export {
  extractEmbedIds,
  formatEmbedRef,
  splitContentByEmbeds
};
