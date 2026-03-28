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
type ViewMode = "chat" | "bg-dashboard" | "bg-session";
interface ChatHeaderProps {
    onClose: () => void;
    onClear: () => void;
    isRunning: boolean;
    sessionUsage: SessionUsage;
    onModelChange: (model: string) => void;
    sessions?: SessionTab[];
    viewMode?: ViewMode;
    bgCount?: number;
    bgSessionLabel?: string;
    onViewChat?: () => void;
    onViewBgDashboard?: () => void;
    onViewBgBack?: () => void;
}
declare function ChatHeader({ onClose, onClear, isRunning, sessionUsage, onModelChange, sessions, viewMode, bgCount, bgSessionLabel, onViewChat, onViewBgDashboard, onViewBgBack }: ChatHeaderProps): react_jsx_runtime.JSX.Element;

export { ChatHeader };
