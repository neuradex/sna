import * as react_jsx_runtime from 'react/jsx-runtime';

interface SnaProviderProps {
    children: React.ReactNode;
    /**
     * Whether to show the chat panel open by default.
     * Only applies when there is no persisted state in localStorage.
     * @default false
     */
    defaultOpen?: boolean;
    /**
     * Permission mode for the spawned agent.
     * @default "acceptEdits"
     */
    dangerouslySkipPermissions?: boolean;
    /**
     * Override the SNA internal API server URL.
     * Defaults to http://localhost:3099 (started automatically by `sna up`).
     */
    snaUrl?: string;
}
/**
 * SnaProvider — right chat panel をアプリに埋め込むルートコンポーネント。
 *
 * Agent session (Claude Code via stdio spawn) を自動で開始し、
 * チャットパネルを通じてユーザーとエージェントを接続する。
 *
 * @example
 * import { SnaProvider } from "sna/components/sna-provider";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <SnaProvider defaultOpen>
 *       {children}
 *     </SnaProvider>
 *   );
 * }
 */
declare function SnaProvider({ children, defaultOpen, dangerouslySkipPermissions, snaUrl, }: SnaProviderProps): react_jsx_runtime.JSX.Element;

export { SnaProvider };
