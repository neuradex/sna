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
interface ChatHeaderProps {
    onClose: () => void;
    onClear: () => void;
    isRunning: boolean;
    sessionUsage: SessionUsage;
    onModelChange: (model: string) => void;
}
declare function ChatHeader({ onClose, onClear, isRunning, sessionUsage, onModelChange }: ChatHeaderProps): react_jsx_runtime.JSX.Element;

export { ChatHeader };
