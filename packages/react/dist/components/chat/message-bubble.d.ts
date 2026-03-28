import * as react_jsx_runtime from 'react/jsx-runtime';
import { ChatMessage } from '../../stores/chat-store.js';
import 'zustand';

interface MessageBubbleProps {
    message: ChatMessage;
    isLast?: boolean;
}
declare function MessageBubble({ message, isLast }: MessageBubbleProps): react_jsx_runtime.JSX.Element;

export { MessageBubble };
