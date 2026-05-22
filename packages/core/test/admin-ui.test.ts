import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAdminAsset, renderAdminPage } from "../src/server/admin-ui.js";

describe("admin UI assets", () => {
  it("renders the React admin shell", () => {
    const html = renderAdminPage();
    assert.match(html, /<title>SNA Admin<\/title>/);
    assert.match(html, /<div id="root"><\/div>/);
    assert.match(html, /src="\/admin\/assets\/[^"]+\.js"/);
  });

  it("serves built admin assets by /admin path", () => {
    const html = renderAdminPage();
    const assetPath = html.match(/src="\/admin\/([^"]+\.js)"/)?.[1];
    assert.ok(assetPath);
    const asset = getAdminAsset(`/admin/${assetPath}`);
    assert.equal(asset?.contentType, "text/javascript; charset=utf-8");
    assert.ok(asset.content.length > 0);
  });
});
