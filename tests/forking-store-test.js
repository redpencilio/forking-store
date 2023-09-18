import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { describe, mock } from "node:test";
import { namedNode, quad } from "rdflib";

import ForkingStore from "../src/forking-store.js";

describe("ForkingStore", () => {
  describe("observers", () => {
    test("observers can be used to receive store updates", () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer, "unique-key");
      assert.equal(observer.mock.callCount(), 0);

      store.addAll([randomQuad()]);
      assert.equal(observer.mock.callCount(), 1);

      store.deregisterObserver("unique-key");
      store.addAll([randomQuad()]);
      assert.equal(
        observer.mock.callCount(),
        1,
        "after `deregisterObserver` the observer is no longer called",
      );
    });

    test("the key argument on the `registerObserver` method is optional", () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer);
      assert.equal(observer.mock.callCount(), 0);

      store.addAll([randomQuad()]);
      assert.equal(observer.mock.callCount(), 1);

      store.deregisterObserver(observer);
      store.addAll([randomQuad()]);
      assert.equal(
        observer.mock.callCount(),
        1,
        "without an explicit key the function reference is used instead",
      );
    });

    test("`clearObservers` removes all registered observers", () => {
      const store = new ForkingStore();
      const observerA = mock.fn();
      const observerB = mock.fn();

      store.registerObserver(observerA, "observer-a");
      store.registerObserver(observerB, "observer-b");
      assert.equal(observerA.mock.callCount(), 0);
      assert.equal(observerB.mock.callCount(), 0);

      store.addAll([randomQuad()]);
      assert.equal(observerA.mock.callCount(), 1);
      assert.equal(observerB.mock.callCount(), 1);

      store.clearObservers();
      store.addAll([randomQuad()]);
      assert.equal(observerA.mock.callCount(), 1);
      assert.equal(observerB.mock.callCount(), 1);
    });
  });
});

function randomQuad() {
  return quad(
    namedNode(`http://subject/${randomUUID()}`),
    namedNode(`http://predicate/${randomUUID()}`),
    `literal-${randomUUID()}`,
    namedNode(`http://graph/${randomUUID()}`),
  );
}
