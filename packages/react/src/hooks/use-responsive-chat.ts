"use client";

import { useEffect, useState } from "react";

export type ChatMode = "side-by-side" | "overlay" | "fullscreen";

/**
 * useResponsiveChat — detects the appropriate chat panel display mode
 * based on viewport width.
 *
 * - Desktop (≥1024px): side-by-side — chat panel beside main content
 * - Tablet (768–1023px): overlay — chat slides over content
 * - Mobile (<768px): fullscreen — chat covers entire viewport
 */
export function useResponsiveChat(): { mode: ChatMode } {
  const [mode, setMode] = useState<ChatMode>("side-by-side");

  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      setMode(w < 768 ? "fullscreen" : w < 1024 ? "overlay" : "side-by-side");
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return { mode };
}
