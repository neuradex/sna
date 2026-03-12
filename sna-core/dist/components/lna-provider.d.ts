import * as react_jsx_runtime from 'react/jsx-runtime';

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
declare function LnaProvider({ children, className, defaultOpen, dangerouslySkipPermissions, }: LnaProviderProps): react_jsx_runtime.JSX.Element;

export { LnaProvider };
