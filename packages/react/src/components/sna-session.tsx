"use client";

import { useMemo } from "react";
import { SnaContext, useSnaContext } from "../context.js";

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
export function SnaSession({ id, children }: SnaSessionProps) {
  const parent = useSnaContext();
  const value = useMemo(
    () => ({ ...parent, sessionId: id }),
    [parent, id],
  );

  return (
    <SnaContext.Provider value={value}>
      {children}
    </SnaContext.Provider>
  );
}
