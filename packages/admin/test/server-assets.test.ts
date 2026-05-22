import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("admin server assets", () => {
  it("exposes a routable SPA shell and static assets after build", async () => {
    const { getAdminAsset, renderAdminPage } = await import("../dist/server.js");
    const html = renderAdminPage();
    assert.match(html, /<div id="root"><\/div>/);
    const scriptPath = html.match(/src="\/admin\/([^"]+\.js)"/)?.[1];
    assert.ok(scriptPath, "admin HTML should reference a built script asset");
    const asset = getAdminAsset(`/admin/${scriptPath}`);
    assert.equal(asset?.contentType, "text/javascript; charset=utf-8");
    assert.ok(asset?.content.length);
  });
});
