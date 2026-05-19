import { NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { i18n, localeNames } from '@/lib/i18n';
import { docsContentRoute, docsRoute } from '@/lib/shared';

// Routes that never get a locale prefix (assets, API, content shims).
const NON_LOCALIZED_PREFIXES = [
  '/api',
  '/og',
  '/_next',
  '/llms.txt',
  '/llms-full.txt',
  '/llms.mdx',
  '/favicon',
];

const LOCALES = new Set(i18n.languages);

const { rewrite: rewriteDocs } = rewritePath(
  `${docsRoute}{/*path}`,
  `${docsContentRoute}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `${docsRoute}{/*path}.md`,
  `${docsContentRoute}{/*path}/content.md`,
);

function hasLocalePrefix(pathname: string): string | null {
  const first = pathname.split('/')[1];
  return first && LOCALES.has(first) ? first : null;
}

function isNonLocalized(pathname: string): boolean {
  return NON_LOCALIZED_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Markdown content negotiation runs first (existing behavior).
  const suffixResult = rewriteSuffix(pathname);
  if (suffixResult) {
    return NextResponse.rewrite(new URL(suffixResult, request.nextUrl));
  }
  if (isMarkdownPreferred(request)) {
    const result = rewriteDocs(pathname);
    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl));
    }
  }

  // Skip non-localized paths.
  if (isNonLocalized(pathname)) {
    return NextResponse.next();
  }

  // Already locale-prefixed: continue.
  if (hasLocalePrefix(pathname)) {
    return NextResponse.next();
  }

  // No prefix: rewrite to the default locale internally so the [lang]
  // file-system route resolves. URL in the browser stays clean.
  // hideLocale: 'default-locale' semantics.
  const url = request.nextUrl.clone();
  url.pathname = `/${i18n.defaultLanguage}${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url);
}

// Expose localeNames so tests/tooling can introspect.
export { localeNames };
