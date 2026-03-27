import * as react_jsx_runtime from 'react/jsx-runtime';

interface ChatInputProps {
    onSend: (text: string) => void;
    disabled: boolean;
}
declare function ChatInput({ onSend, disabled }: ChatInputProps): react_jsx_runtime.JSX.Element;

export { ChatInput };
