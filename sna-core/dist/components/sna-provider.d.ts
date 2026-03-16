import * as react_jsx_runtime from 'react/jsx-runtime';

interface SnaProviderProps {
    children: React.ReactNode;
    /**
     * Whether to show the terminal drawer open by default.
     * Only applies when there is no persisted state in localStorage.
     * @default false
     */
    defaultOpen?: boolean;
    /**
     * Pass `--dangerously-skip-permissions` to Claude when spawning the terminal.
     * @default false
     */
    dangerouslySkipPermissions?: boolean;
}
declare function SnaProvider({ children, defaultOpen, dangerouslySkipPermissions, }: SnaProviderProps): react_jsx_runtime.JSX.Element;

export { SnaProvider };
