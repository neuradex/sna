import * as react_jsx_runtime from 'react/jsx-runtime';

interface SessionUsage {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    contextWindow: number;
    lastTurnContextTokens: number;
    lastTurnSystemTokens: number;
    lastTurnConvTokens: number;
    model: string;
}
interface SessionTab {
    id: string;
    label: string;
    hasNewActivity: boolean;
}
interface ChatHeaderProps {
    onClose: () => void;
    onClear: () => void;
    isRunning: boolean;
    sessionUsage: SessionUsage;
    onModelChange: (model: string) => void;
    sessions?: SessionTab[];
    activeSessionId?: string;
    onSessionChange?: (id: string) => void;
    onSessionClose?: (id: string) => void;
}
declare function ChatHeader({ onClose, onClear, isRunning, sessionUsage, onModelChange, sessions, activeSessionId, onSessionChange, onSessionClose }: ChatHeaderProps): react_jsx_runtime.JSX.Element;

export { ChatHeader };
