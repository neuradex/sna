"use client";

import { TERMINAL_BAR_HEIGHT } from "../lib/terminal/constants.js";

/**
 * TerminalSpacer — bottom drawer バーの高さ分だけスペースを確保するコンポーネント。
 *
 * ページやレイアウトの一番下に置くことで、コンテンツがドロワーバーに隠れない。
 *
 * @example
 * export default function Page() {
 *   return (
 *     <main>
 *       ...content...
 *       <TerminalSpacer />
 *     </main>
 *   );
 * }
 */
export function TerminalSpacer() {
  return <div style={{ height: TERMINAL_BAR_HEIGHT, flexShrink: 0 }} />;
}
