import * as react_jsx_runtime from 'react/jsx-runtime';
import * as reactTooltip from '@radix-ui/react-tooltip';
export { reactTooltip as TooltipPrimitive };

interface TooltipProps {
    content: string;
    children: React.ReactNode;
}
declare function Tooltip({ content, children }: TooltipProps): react_jsx_runtime.JSX.Element;

export { Tooltip };
