import * as react_jsx_runtime from 'react/jsx-runtime';
import { ChatMessage } from '../../stores/chat-store.js';
import 'zustand';

declare function ToolUseCard({ message }: {
    message: ChatMessage;
}): react_jsx_runtime.JSX.Element;

export { ToolUseCard };
