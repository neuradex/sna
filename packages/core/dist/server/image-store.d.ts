/**
 * Image storage — saves base64 images to disk and serves them.
 *
 * Storage path: data/images/{sessionId}/{hash}.{ext}
 * Retrieve via: GET /chat/images/:sessionId/:filename
 */
interface SavedImage {
    filename: string;
    path: string;
}
/**
 * Save base64 images to disk. Returns filenames for meta storage.
 */
declare function saveImages(sessionId: string, images: Array<{
    base64: string;
    mimeType: string;
}>): string[];
/**
 * Resolve an image file path. Returns null if not found.
 */
declare function resolveImagePath(sessionId: string, filename: string): string | null;

export { type SavedImage, resolveImagePath, saveImages };
