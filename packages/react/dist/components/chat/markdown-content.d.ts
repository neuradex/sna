import * as react_jsx_runtime from 'react/jsx-runtime';

interface MarkdownContentProps {
    text: string;
    /** Inline HTML to append at the end of the last paragraph */
    suffixHtml?: string;
}
declare function MarkdownContent({ text, suffixHtml }: MarkdownContentProps): react_jsx_runtime.JSX.Element;

export { MarkdownContent };
