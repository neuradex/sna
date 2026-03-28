import * as react_jsx_runtime from 'react/jsx-runtime';
import { ChatMessage } from '../../stores/chat-store.js';
import 'zustand/middleware';
import 'zustand';

interface MessageBubbleProps {
    message: ChatMessage;
}
declare function MessageBubble({ message }: MessageBubbleProps): react_jsx_runtime.JSX.Element;

export { MessageBubble };
