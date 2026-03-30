import * as react_jsx_runtime from 'react/jsx-runtime';

interface SnaProviderProps {
    children: React.ReactNode;
    /**
     * Override the SNA internal API server URL.
     * Defaults to auto-discovery via /api/sna-port, then http://localhost:3099.
     */
    snaUrl?: string;
    /**
     * Session ID for this provider scope.
     * @default "default"
     */
    sessionId?: string;
}
/**
 * SnaProvider — provides SNA context (apiUrl + sessionId) to the app.
 *
 * This is a pure context provider. No UI, no peer deps beyond React.
 * For built-in chat UI, import and render <SnaChatUI /> separately.
 *
 * @example
 * // Minimal — context only
 * <SnaProvider snaUrl="http://localhost:52341">
 *   {children}
 * </SnaProvider>
 *
 * // With built-in chat UI
 * import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";
 * <SnaProvider>
 *   {children}
 *   <SnaChatUI />
 * </SnaProvider>
 *
 * // Multi-session with SnaSession
 * import { SnaSession } from "@sna-sdk/react/components/sna-session";
 * <SnaProvider snaUrl={apiUrl}>
 *   <SnaSession id="default"><HelperAgent /></SnaSession>
 *   <SnaSession id={projectSessionId}><ChatArea /></SnaSession>
 * </SnaProvider>
 */
declare function SnaProvider({ children, snaUrl, sessionId, }: SnaProviderProps): react_jsx_runtime.JSX.Element;

export { SnaProvider };
