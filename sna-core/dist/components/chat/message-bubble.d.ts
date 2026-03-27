import * as react_jsx_runtime from 'react/jsx-runtime';
import { ChatMessage } from '../../stores/chat-store.js';
import 'zustand/middleware';
import 'zustand';

interface MessageBubbleProps {
    message: ChatMessage;
    onPermissionApprove?: () => void;
    onPermissionDeny?: () => void;
}
declare function MessageBubble({ message, onPermissionApprove, onPermissionDeny }: MessageBubbleProps): react_jsx_runtime.JSX.Element;

export { MessageBubble };
