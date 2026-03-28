type ChatMode = "side-by-side" | "overlay" | "fullscreen";
/**
 * useResponsiveChat — detects the appropriate chat panel display mode
 * based on viewport width.
 *
 * - Desktop (≥1024px): side-by-side — chat panel beside main content
 * - Tablet (768–1023px): overlay — chat slides over content
 * - Mobile (<768px): fullscreen — chat covers entire viewport
 */
declare function useResponsiveChat(): {
    mode: ChatMode;
};

export { type ChatMode, useResponsiveChat };
