const assert = require("node:assert");
const test = require("node:test");

const {
  default: ForkingStore,
  addGraphFor,
  delGraphFor,
} = require("forking-store"); // eslint-disable-line n/no-missing-require
const { additionGraphFor, deletionGraphFor } = require("../dist/forking-store");

test("CJS imports work", () => {
  assert.ok(ForkingStore);
  assert.ok(addGraphFor);
  assert.ok(delGraphFor);
  assert.ok(additionGraphFor);
  assert.ok(deletionGraphFor);
});
