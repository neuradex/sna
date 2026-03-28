import * as react_jsx_runtime from 'react/jsx-runtime';

interface ChatPanelProps {
    onClose: () => void;
    /** Session ID for multi-session support. Defaults to "default". */
    sessionId?: string;
}
declare function ChatPanel({ onClose, sessionId }: ChatPanelProps): react_jsx_runtime.JSX.Element;

export { ChatPanel };
