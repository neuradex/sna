import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../src/api";
import { ErrorText, InlineErrorText, Skeleton, TableSkeleton } from "../src/components/ui";

describe("loading skeletons", () => {
  it("renders the shared shimmer class", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { className: "h-4 w-20" }));

    assert.match(html, /skeleton-shimmer/);
    assert.match(html, /h-4/);
    assert.match(html, /w-20/);
  });

  it("renders table loading placeholders with status semantics", () => {
    const html = renderToStaticMarkup(createElement(TableSkeleton, { columns: 3, rows: 2 }));
    const shimmerCount = html.match(/skeleton-shimmer/g)?.length ?? 0;

    assert.match(html, /role="status"/);
    assert.match(html, /aria-label="Loading"/);
    assert.equal(shimmerCount, 9);
  });

  it("renders admin guidance for unauthorized API errors", () => {
    const html = renderToStaticMarkup(createElement(ErrorText, { error: new ApiError("Unauthorized", 401) }));

    assert.match(html, /role="alert"/);
    assert.match(html, /Admin session required/);
    assert.match(html, /daemon \/admin URL/);
    assert.match(html, /401 Unauthorized/);
  });

  it("renders compact permission errors for inline actions", () => {
    const html = renderToStaticMarkup(createElement(InlineErrorText, { error: new ApiError("Forbidden", 403) }));

    assert.match(html, /Permission denied/);
    assert.match(html, /Forbidden/);
  });
});
