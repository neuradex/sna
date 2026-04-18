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
type Segment = {
    type: "text";
    text: string;
} | {
    type: "embed";
    id: string;
};
/**
 * Split content text into alternating text/embed segments in source order.
 * Empty text segments (e.g. back-to-back refs) are preserved to keep ordering
 * explicit; callers should filter them if they want.
 */
declare function splitContentByEmbeds(content: string): Segment[];
/** Format an inline embed ref for insertion into content text. */
declare function formatEmbedRef(id: string, altText?: string): string;
/** Extract all embed ids referenced in a content string. */
declare function extractEmbedIds(content: string): string[];

export { type Segment, extractEmbedIds, formatEmbedRef, splitContentByEmbeds };
