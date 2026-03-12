import * as zustand_middleware from 'zustand/middleware';
import * as zustand from 'zustand';

interface TerminalState {
    isOpen: boolean;
    width: number;
    /** WebSocket is open and PTY is spawned */
    connected: boolean;
    /** WebSocket is currently connecting or reconnecting */
    isConnecting: boolean;
    writeFn: ((data: string) => void) | null;
    setOpen: (open: boolean) => void;
    toggle: () => void;
    setWidth: (width: number) => void;
    setConnected: (connected: boolean) => void;
    setIsConnecting: (isConnecting: boolean) => void;
    setWriteFn: (fn: ((data: string) => void) | null) => void;
    sendToTerminal: (text: string) => void;
}
declare const useTerminalStore: zustand.UseBoundStore<Omit<zustand.StoreApi<TerminalState>, "setState" | "persist"> & {
    setState(partial: TerminalState | Partial<TerminalState> | ((state: TerminalState) => TerminalState | Partial<TerminalState>), replace?: false | undefined): unknown;
    setState(state: TerminalState | ((state: TerminalState) => TerminalState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<zustand_middleware.PersistOptions<TerminalState, {
            isOpen: boolean;
            width: number;
        }, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: TerminalState) => void) => () => void;
        onFinishHydration: (fn: (state: TerminalState) => void) => () => void;
        getOptions: () => Partial<zustand_middleware.PersistOptions<TerminalState, {
            isOpen: boolean;
            width: number;
        }, unknown>>;
    };
}>;

export { useTerminalStore };
