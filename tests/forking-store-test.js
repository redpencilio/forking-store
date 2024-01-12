import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { describe, mock } from "node:test";
import { namedNode } from "rdflib";

import ForkingStore from "../src/forking-store.js";
import { waitForIdleStore } from "./helpers/wait-for-idle-store.js";

describe("ForkingStore", () => {
  describe("observers", () => {
    test("observers can be used to receive store updates", async () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer, "unique-key");
      assert.equal(observer.mock.callCount(), 0);

      store.addAll([randomQuad()]);
      await waitForIdleStore(store);
      assert.equal(observer.mock.callCount(), 1);

      store.deregisterObserver("unique-key");
      store.addAll([randomQuad()]);
      await waitForIdleStore(store);
      assert.equal(
        observer.mock.callCount(),
        1,
        "after `deregisterObserver` the observer is no longer called",
      );
    });

    test("the key argument on the `registerObserver` method is optional", async () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer);
      assert.equal(observer.mock.callCount(), 0);

      store.addAll([randomQuad()]);
      await waitForIdleStore(store);
      assert.equal(observer.mock.callCount(), 1);

      store.deregisterObserver(observer);
      store.addAll([randomQuad()]);
      await waitForIdleStore(store);
      assert.equal(
        observer.mock.callCount(),
        1,
        "without an explicit key the function reference is used instead",
      );
    });

    test("store.addAll passes an object to the observer with the added triples under the `inserts` key", async () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer);
      assert.equal(observer.mock.callCount(), 0);

      const inserts = [randomQuad(), randomQuad()];
      store.addAll(inserts);
      await waitForIdleStore(store);

      const call = observer.mock.calls.at(0);
      assert.deepEqual(call.arguments.at(0), { inserts, deletes: [] });
    });

    test("`store.removeStatements` passes an object to the observer with the added triples under the `deletes` key", async () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer);
      assert.equal(observer.mock.callCount(), 0);

      const deletes = [randomQuad(), randomQuad()];
      store.removeStatements(deletes);
      await waitForIdleStore(store);

      const call = observer.mock.calls.at(0);
      assert.deepEqual(call.arguments.at(0), { inserts: [], deletes });
    });

    test("multiple `addAll` and `removeStatements` calls will only trigger a single observer call", async () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer);
      assert.equal(observer.mock.callCount(), 0);

      let deletes = [randomQuad(), randomQuad()];
      store.removeStatements(deletes);

      let inserts = [randomQuad(), randomQuad()];
      store.addAll(inserts);

      await waitForIdleStore(store);

      assert.equal(observer.mock.callCount(), 1);

      let call = observer.mock.calls.at(0);
      assert.deepEqual(call.arguments.at(0), { inserts, deletes });

      inserts = [randomQuad(), randomQuad()];
      store.addAll(inserts);
      await waitForIdleStore(store);
      assert.equal(observer.mock.callCount(), 2);

      call = observer.mock.calls.at(1);
      assert.deepEqual(call.arguments.at(0), { inserts, deletes: [] });
    });

    test("redundant data changes are removed", async () => {
      const store = new ForkingStore();
      const observer = mock.fn();

      store.registerObserver(observer);
      assert.equal(observer.mock.callCount(), 0);

      const redundantQuad = randomQuad();
      let inserts = [redundantQuad];
      store.addAll(inserts);

      let deletes = [redundantQuad];
      store.removeStatements(deletes);

      await waitForIdleStore(store);

      assert.equal(
        observer.mock.callCount(),
        0,
        "The observers aren't triggered if there are no actual changes",
      );

      const quad = randomQuad();
      inserts = [redundantQuad, quad];
      store.addAll(inserts);

      deletes = [redundantQuad];
      store.removeStatements(deletes);
      await waitForIdleStore(store);
      assert.equal(observer.mock.callCount(), 1);

      let call = observer.mock.calls.at(0);
      assert.deepEqual(
        call.arguments.at(0),
        { inserts: [quad], deletes: [] },
        "Only the actual changes are returned",
      );
    });

    test("`clearObservers` removes all registered observers", async () => {
      const store = new ForkingStore();
      const observerA = mock.fn();
      const observerB = mock.fn();

      store.registerObserver(observerA);
      store.registerObserver(observerB);
      assert.equal(observerA.mock.callCount(), 0);
      assert.equal(observerB.mock.callCount(), 0);

      store.addAll([randomQuad()]);
      await waitForIdleStore(store);
      assert.equal(observerA.mock.callCount(), 1);
      assert.equal(observerB.mock.callCount(), 1);

      store.clearObservers();
      store.addAll([randomQuad()]);
      await waitForIdleStore(store);
      assert.equal(observerA.mock.callCount(), 1);
      assert.equal(observerB.mock.callCount(), 1);
    });
  });
});

function randomQuad() {
  return {
    subject: namedNode(`http://subject/${randomUUID()}`),
    predicate: namedNode(`http://predicate/${randomUUID()}`),
    object: `literal-${randomUUID()}`,
    graph: namedNode(`http://graph/${randomUUID()}`),
  };
}
