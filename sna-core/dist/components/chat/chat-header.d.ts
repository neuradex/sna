import * as react_jsx_runtime from 'react/jsx-runtime';

interface ChatHeaderProps {
    onClose: () => void;
    onClear: () => void;
    isRunning: boolean;
}
declare function ChatHeader({ onClose, onClear, isRunning }: ChatHeaderProps): react_jsx_runtime.JSX.Element;

export { ChatHeader };
