import * as zustand_middleware from 'zustand/middleware';
import * as zustand from 'zustand';

interface TerminalState {
    isOpen: boolean;
    height: number;
    fontSize: number;
    /** WebSocket is open and PTY is spawned */
    connected: boolean;
    /** WebSocket is currently connecting or reconnecting */
    isConnecting: boolean;
    writeFn: ((data: string) => void) | null;
    focusFn: (() => void) | null;
    fitFn: (() => void) | null;
    setOpen: (open: boolean) => void;
    toggle: () => void;
    setHeight: (height: number) => void;
    setFontSize: (fontSize: number) => void;
    setConnected: (connected: boolean) => void;
    setIsConnecting: (isConnecting: boolean) => void;
    setWriteFn: (fn: ((data: string) => void) | null) => void;
    setFocusFn: (fn: (() => void) | null) => void;
    setFitFn: (fn: (() => void) | null) => void;
    sendToTerminal: (text: string) => void;
    /** Send a skill command via /sna-sub so it runs as a subagent */
    sendToTerminalSub: (text: string) => void;
}
declare const useTerminalStore: zustand.UseBoundStore<Omit<zustand.StoreApi<TerminalState>, "setState" | "persist"> & {
    setState(partial: TerminalState | Partial<TerminalState> | ((state: TerminalState) => TerminalState | Partial<TerminalState>), replace?: false | undefined): unknown;
    setState(state: TerminalState | ((state: TerminalState) => TerminalState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<zustand_middleware.PersistOptions<TerminalState, {
            isOpen: boolean;
            height: number;
            fontSize: number;
        }, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: TerminalState) => void) => () => void;
        onFinishHydration: (fn: (state: TerminalState) => void) => () => void;
        getOptions: () => Partial<zustand_middleware.PersistOptions<TerminalState, {
            isOpen: boolean;
            height: number;
            fontSize: number;
        }, unknown>>;
    };
}>;

export { useTerminalStore };
