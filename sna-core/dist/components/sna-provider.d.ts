import * as react_jsx_runtime from 'react/jsx-runtime';

interface SnaProviderProps {
    children: React.ReactNode;
    /** Terminal panel側の幅は固定なので、left側のclassをカスタムしたい場合に使う */
    className?: string;
}
/**
 * SnaProvider — TerminalPanel をツリーの外側で一度だけマウントするルートコンポーネント。
 *
 * layout.tsx のルートに置くこと。children がどれだけ re-render しても
 * TerminalPanel は再マウントされない。
 *
 * @example
 * // app/layout.tsx
 * import { SnaProvider } from "sna-core/components/sna-provider";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <SnaProvider>{children}</SnaProvider>
 *       </body>
 *     </html>
 *   );
 * }
 */
declare function SnaProvider({ children, className }: SnaProviderProps): react_jsx_runtime.JSX.Element;

export { SnaProvider };
