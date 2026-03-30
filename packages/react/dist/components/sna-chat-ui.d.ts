import * as react_jsx_runtime from 'react/jsx-runtime';

interface SnaChatUIProps {
    children: React.ReactNode;
    /** Open chat panel on first visit. @default false */
    defaultOpen?: boolean;
    /** Skip Claude permission prompts. @default false */
    dangerouslySkipPermissions?: boolean;
}
/**
 * SnaChatUI — built-in chat panel with agent auto-start.
 *
 * Requires @radix-ui/react-tooltip as a peer dependency.
 * Must be rendered inside <SnaProvider>.
 *
 * @example
 * import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
 * import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";
 *
 * <SnaProvider>
 *   <SnaChatUI>{children}</SnaChatUI>
 * </SnaProvider>
 */
declare function SnaChatUI({ children, defaultOpen, dangerouslySkipPermissions, }: SnaChatUIProps): react_jsx_runtime.JSX.Element;

export { SnaChatUI };
