import * as react_jsx_runtime from 'react/jsx-runtime';

interface SnaConnection {
    baseUrl: string;
    authToken?: string;
}
interface SnaProviderProps {
    children: React.ReactNode;
    /**
     * Connection object returned by startSnaServer/startSnaServerInProcess.
     * Prefer this in SDK-managed apps so the auth token stays paired with
     * the server handle.
     */
    connection?: SnaConnection;
    /**
     * Override the SNA internal API server URL.
     * Defaults to auto-discovery via /api/sna-port, then http://localhost:3099.
     */
    snaUrl?: string;
    /** Bearer token override for custom deployments. Prefer `connection`. */
    authToken?: string;
    /**
     * Session ID for this provider scope.
     * @default "default"
     */
    sessionId?: string;
    /**
     * Whether to hydrate chat sessions on mount.
     * Set to false if your app doesn't use the chat store.
     * @default true
     */
    hydrate?: boolean;
}
/**
 * SnaProvider — provides SNA context (apiUrl + sessionId) to the app.
 *
 * This is a pure context provider. No UI, no peer deps beyond React.
 * For built-in chat UI, import and render <SnaChatUI /> separately.
 *
 * @example
 * // Minimal — context only
 * <SnaProvider connection={sna.connection}>
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
declare function SnaProvider({ children, connection, snaUrl, authToken, sessionId, hydrate: shouldHydrate, }: SnaProviderProps): react_jsx_runtime.JSX.Element;

export { type SnaConnection, SnaProvider, type SnaProviderProps };
