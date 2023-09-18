const assert = require("node:assert");
const test = require("node:test");

// eslint-disable-next-line n/no-missing-require
const { default: ForkingStore, addGraphFor, delGraphFor} = require("forking-store");

test("CJS imports work", () => {
  assert.ok(ForkingStore);
  assert.ok(addGraphFor);
  assert.ok(delGraphFor);
});
