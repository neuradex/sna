import * as react_jsx_runtime from 'react/jsx-runtime';

interface SnaSessionProps {
    /** Session ID for this scope. All child hooks will use this session. */
    id: string;
    children: React.ReactNode;
}
/**
 * SnaSession — scopes a session ID for all descendant SNA hooks.
 *
 * @example
 * // Multi-session (vibe-station)
 * <SnaProvider snaUrl={apiUrl}>
 *   <SnaSession id="default">
 *     <HelperAgent />
 *   </SnaSession>
 *   <SnaSession id={activeProjectSessionId}>
 *     <ChatArea />
 *   </SnaSession>
 * </SnaProvider>
 *
 * // Single-session (no SnaSession needed — defaults to "default")
 * <SnaProvider>
 *   {children}
 * </SnaProvider>
 */
declare function SnaSession({ id, children }: SnaSessionProps): react_jsx_runtime.JSX.Element;

export { SnaSession };
