"use client";
import { useEffect, useState } from "react";
function useResponsiveChat() {
  const [mode, setMode] = useState("side-by-side");
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
export {
  useResponsiveChat
};
