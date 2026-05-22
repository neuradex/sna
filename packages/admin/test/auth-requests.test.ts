import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canActOnAuthRequest } from "../src/features/auth-requests.js";

describe("auth request actions", () => {
  it("only allows owner actions while a request is pending", () => {
    assert.equal(canActOnAuthRequest({ status: "pending" }), true);
    assert.equal(canActOnAuthRequest({ status: "approved" }), false);
    assert.equal(canActOnAuthRequest({ status: "consumed" }), false);
    assert.equal(canActOnAuthRequest({ status: "denied" }), false);
    assert.equal(canActOnAuthRequest({ status: "expired" }), false);
  });
});
