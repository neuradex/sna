import * as react_jsx_runtime from 'react/jsx-runtime';

interface ResizeHandleProps {
    onResize: (newWidth: number) => void;
    currentWidth: number;
}
declare function ResizeHandle({ onResize, currentWidth }: ResizeHandleProps): react_jsx_runtime.JSX.Element;

export { ResizeHandle };
