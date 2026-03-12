"use client";

import { memo, useEffect } from "react";
import { TerminalPanel } from "./terminal/terminal-panel.js";
import { useTerminalStore } from "../stores/terminal-store.js";

interface TerminalPanelWrapperProps {
  dangerouslySkipPermissions: boolean;
}

// memo で囲むことで、親(children側)のre-renderがTerminalPanelに伝播しない
// → xterm インスタンスが破棄されない
const StableTerminalPanel = memo(function StableTerminalPanel({ dangerouslySkipPermissions }: TerminalPanelWrapperProps) {
  return <TerminalPanel dangerouslySkipPermissions={dangerouslySkipPermissions} />;
});

interface LnaProviderProps {
  children: React.ReactNode;
  /** Terminal panel側の幅は固定なので、left側のclassをカスタムしたい場合に使う */
  className?: string;
  /**
   * Whether to show the terminal panel open by default.
   * Only applies when there is no persisted state in localStorage.
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Pass `--dangerously-skip-permissions` to Claude when spawning the terminal.
   * Use this in trusted local environments to skip permission prompts.
   * @default false
   */
  dangerouslySkipPermissions?: boolean;
}

/**
 * LnaProvider — TerminalPanel をツリーの外側で一度だけマウントするルートコンポーネント。
 *
 * layout.tsx のルートに置くこと。children がどれだけ re-render しても
 * TerminalPanel は再マウントされない。
 *
 * @example
 * // app/layout.tsx
 * import { LnaProvider } from "sna/components/lna-provider";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <LnaProvider defaultOpen dangerouslySkipPermissions>
 *           {children}
 *         </LnaProvider>
 *       </body>
 *     </html>
 *   );
 * }
 */
export function LnaProvider({
  children,
  className,
  defaultOpen = false,
  dangerouslySkipPermissions = false,
}: LnaProviderProps) {
  // Apply defaultOpen only when there is no persisted state yet
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("terminal-panel")) {
      useTerminalStore.getState().setOpen(defaultOpen);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <div className={`flex-1 overflow-auto min-w-0 ${className ?? ""}`}>
        {children}
      </div>
      <StableTerminalPanel dangerouslySkipPermissions={dangerouslySkipPermissions} />
    </div>
  );
}
