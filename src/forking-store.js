import {
  graph,
  parse,
  serialize,
  Fetcher,
  UpdateManager,
  namedNode,
  Statement,
  Literal,
  quad,
} from "rdflib";

const BASE_GRAPH_STRING = "http://mu.semte.ch/libraries/rdf-store";

export default class ForkingStore {
  graph = graph();
  fetcher = null;
  updater = null;
  observers = new Map();
  #callbackBatcher = null;

  constructor() {
    this.fetcher = new Fetcher(this.graph);
    this.updater = new UpdateManager(this.graph);
    this.#callbackBatcher = new NotifyObserverBatcher((data) => {
      this.#handleBatchedStatements(data);
    });
  }

  // Private, only to be used by the test helper
  get _isIdle() {
    return this.#callbackBatcher.isIdle;
  }

  /**
   * Load data from an external graph.
   */
  async load(source) {
    // TODO: should we remove our changes when a graph is being reloaded?
    await this.fetcher.load(source);
  }

  loadDataWithAddAndDelGraph(content, graph, additions, removals, format) {
    const graphValue = graph.termType == "NamedNode" ? graph.value : graph;
    parse(content, this.graph, graphValue, format);
    if (additions) {
      parse(additions, this.graph, addGraphFor(graph).value, format);
    }
    if (removals) {
      parse(removals, this.graph, delGraphFor(graph).value, format);
    }
  }

  serializeDataWithAddAndDelGraph(graph, format = "text/turtle") {
    return {
      graph: serialize(graph, this.graph, format),
      additions: serialize(addGraphFor(graph), this.graph, format),
      removals: serialize(delGraphFor(graph), this.graph, format),
    };
  }

  serializeDataMergedGraph(graph, format = "text/turtle") {
    return serialize(this.mergedGraph(graph), this.graph, format);
  }

  /**
   * Parses content from a file into a specified graph.
   */
  parse(content, graph, format) {
    const graphValue = graph.termType == "NamedNode" ? graph.value : graph;
    parse(content, this.graph, graphValue, format);
  }

  /**
   * Perform a match on the graph.
   */
  match(subject, predicate, object, graph) {
    if (graph) {
      const mainMatch = this.graph.match(subject, predicate, object, graph);
      const addMatch = this.graph.match(
        subject,
        predicate,
        object,
        addGraphFor(graph),
      );
      const delMatch = this.graph.match(
        subject,
        predicate,
        object,
        delGraphFor(graph),
      );
      return [...mainMatch, ...addMatch]
        .filter((quad) => !delMatch.find((del) => this.equalTriples(del, quad))) // remove statments in delete graph
        .map((quad) => statementInGraph(quad, graph)) // map them to the requested graph
        .reduce((acc, quad) => {
          // find uniques
          if (!acc.find((accQuad) => this.equalTriples(accQuad, quad))) {
            acc.push(quad);
          }
          return acc;
        }, []);
    } else {
      // TODO: this code path is normally unused in our cases,
      // implement it for debugging scenarios.

      return this.graph.match(subject, predicate, object);
    }
  }

  /**
   * internal to compare triples
   */
  equalTriples(a, b) {
    return (
      a.subject.equals(b.subject) &&
      a.predicate.equals(b.predicate) &&
      a.object.equals(b.object)
    );
  }

  /**
   * Perform any match on the graph.
   */
  any(subject, predicate, object, graph) {
    const matches = this.match(subject, predicate, object, graph);

    if (matches.length > 0) {
      const firstMatch = matches[0];
      if (!subject) return firstMatch.subject;
      if (!predicate) return firstMatch.predicate;
      if (!object) return firstMatch.object;
      if (!graph) return firstMatch.graph;
      return true;
    } else {
      return undefined;
    }
  }

  addAll(inserts) {
    this.#callbackBatcher.addData({ inserts });
  }

  removeStatements(deletes) {
    this.#callbackBatcher.addData({ deletes });
  }

  removeMatches(subject, predicate, object, graph) {
    const matches = this.graph.match(subject, predicate, object, graph);
    this.graph.removeStatements(matches);
  }

  allGraphs() {
    const graphStatements = this.graph.match().map(({ graph }) => graph.value);

    return new Set(graphStatements);
  }

  changedGraphs() {
    const forGraphs = new Set();
    for (const graph of this.allGraphs()) {
      let url;
      try {
        url = new URL(graph);
      } catch (e) {
        /* this may happen */
      }

      if (
        url &&
        (url.href.startsWith(`${BASE_GRAPH_STRING}/graphs/add`) ||
          url.href.startsWith(`${BASE_GRAPH_STRING}/graphs/del`))
      ) {
        const target = url.searchParams.get("for");
        if (target) forGraphs.add(target);
      }
    }

    return [...forGraphs];
  }

  mergedGraph(graph) {
    // recalculates the merged graph and returns the graph

    const mergedGraph = mergedGraphFor(graph);
    const delSource = delGraphFor(graph);
    const addSource = addGraphFor(graph);

    const baseContent = this.match(null, null, null, graph).map((statement) =>
      statementInGraph(statement, mergedGraph),
    );
    const delContent = this.match(null, null, null, delSource).map(
      (statement) => statementInGraph(statement, mergedGraph),
    );
    const addContent = this.match(null, null, null, addSource).map(
      (statement) => statementInGraph(statement, mergedGraph),
    );

    // clear the graph
    this.graph.removeMatches(null, null, null, mergedGraph);
    // add baseContent
    baseContent.forEach((statement) => this.graph.add(statement));
    // remove stuff
    delContent.forEach((statement) => {
      try {
        this.graph.remove(statement);
      } catch (e) {
        /* */
      }
    });
    // add stuff
    addContent.forEach((statement) => this.graph.add(statement));

    return mergedGraph;
  }

  async pushGraphChanges(graph) {
    const deletes = this.match(null, null, null, delGraphFor(graph)).map(
      (statement) => statementInGraph(statement, graph),
    );

    const inserts = this.match(null, null, null, addGraphFor(graph)).map(
      (statement) => statementInGraph(statement, graph),
    );

    try {
      await this.update(deletes, inserts);
    } finally {
      this.removeMatches(null, null, null, delGraphFor(graph));
      this.removeMatches(null, null, null, addGraphFor(graph));
    }
  }

  async persist() {
    return await Promise.all(
      this.changedGraphs()
        .map((graphString) => namedNode(graphString))
        .map((graph) => this.pushGraphChanges(graph)),
    );
  }

  /**
   * Promise based version of update protocol
   * private
   */
  update(deletes, inserts) {
    return new Promise((resolve, reject) => {
      this.updater.update(deletes, inserts, resolve, reject);
    });
  }

  /**
   * Registers an observer, optionally with a key.  The observer will
   * be called with objects of the shape { deletes, inserts } for any
   * change that is passed through `this.update`.
   */
  registerObserver(observer, key) {
    key = key || observer;
    this.observers.set(key, observer);
  }

  deregisterObserver(key) {
    this.observers.delete(key);
  }

  /**
   * Removes all the registered observers. This can be used before destroying the form to prevent the observer callback looping.
   */
  clearObservers() {
    this.observers.clear();
  }

  #handleBatchedStatements(statements) {
    const dedupedStatements = removeRendundantChanges(
      statements.inserts,
      statements.deletes,
    );
    const { inserts, deletes } = dedupedStatements;

    if (inserts.length > 0 || deletes.length > 0) {
      for (const ins of inserts) {
        this.graph.add(statementInGraph(ins, addGraphFor(ins.graph)));
        try {
          // NOTE why do we try removing the statement after adding it?
          this.graph.remove(statementInGraph(ins, delGraphFor(ins.graph)));
        } catch (e) {
          // this is okay!  the statement may not exist
        }
      }

      for (const del of deletes) {
        this.graph.add(statementInGraph(del, delGraphFor(del.graph)));
        try {
          this.graph.remove(statementInGraph(del, addGraphFor(del.graph)));
        } catch (e) {
          // this is okay!  the statement may not exist
        }
      }

      informObservers(dedupedStatements, this);
    }
  }
}

/**
 * Yields the graphs which contains additions.
 */
export function addGraphFor(graph) {
  const graphValue = graph.termType == "NamedNode" ? graph.value : graph;
  const base = `${BASE_GRAPH_STRING}/graphs/add`;
  const graphQueryParam = encodeURIComponent(graphValue);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

/**
 * Yields the graph which contains removals.
 */
export function delGraphFor(graph) {
  const graphValue = graph.termType == "NamedNode" ? graph.value : graph;
  const base = `${BASE_GRAPH_STRING}/graphs/del`;
  const graphQueryParam = encodeURIComponent(graphValue);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

function mergedGraphFor(graph) {
  const graphValue = graph.termType == "NamedNode" ? graph.value : graph;
  const base = `${BASE_GRAPH_STRING}/graphs/merged`;
  const graphQueryParam = encodeURIComponent(graphValue);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

function statementInGraph(quad, graph) {
  return new Statement(quad.subject, quad.predicate, quad.object, graph);
}

function informObservers(payload, forkingStore) {
  for (const [observerKey, observer] of [...forkingStore.observers.entries()]) {
    try {
      observer(payload);
    } catch (e) {
      console.error(
        `Something went wrong during the callback of observer ${observerKey}`,
      );
      console.error(e);
    }
  }
}

/**
 * This class is used to batch multiple data mutations into a single callback.
 * Some forms can cause a lot of small data changes which all would trigger a new observer callback.
 * Grouping them into a single call can improve performance and allows us to remove redundant changes.
 */
class NotifyObserverBatcher {
  #batchTimeoutId;
  #dataHandler;
  #pendingDataChanges;

  constructor(dataHandler) {
    this.#setup();
    this.#dataHandler = dataHandler;
  }

  // Used by the test helper
  get isIdle() {
    return !this.#batchTimeoutId;
  }

  #setup() {
    this.#pendingDataChanges = { inserts: [], deletes: [] };
    this.#batchTimeoutId = null;
  }

  #ensureBatch() {
    if (!this.#batchTimeoutId) {
      // We use a timeout delay of 0 so the callback runs as soon as possible while still waiting for all synchronous data changes
      this.#batchTimeoutId = setTimeout(() => {
        this.#dataHandler(this.#pendingDataChanges);
        this.#setup();
      });
    }
  }

  addData({ inserts = [], deletes = [] }) {
    this.#ensureBatch();

    this.#pendingDataChanges.inserts.push(...inserts);
    this.#pendingDataChanges.deletes.push(...deletes);
  }
}

/**
 * @typedef {Object} QuadLike - regular object with the same properties as Rdflib's BaseQuad type: https://github.com/linkeddata/rdflib.js/blob/6ab4f04a089f271af31d04c6242197cf32f3a333/src/tf-types.ts#L44
 * @property {import("rdflib").NamedNode} subject - a string property of SpecialType
 * @property {import("rdflib").NamedNode} predicate - a number property of SpecialType
 * @property {import("rdflib").Literal | string} object - an optional number property of SpecialType
 * @property {import("rdflib").NamedNode} graph - an optional number property of SpecialType
 */

/**
 * Removes statements that appear in both the inserts and deletes arrays
 *
 * @param {QuadLike[]} inserts
 * @param {QuadLike[]} deletes
 * @returns {{ inserts: QuadLike[], deletes: QuadLike[] }}
 */
function removeRendundantChanges(inserts, deletes) {
  return {
    inserts: inserts.filter((insert) => {
      return !deletes.some((del) => {
        console.log("del", del, "insert", insert);
        return areQuadsEqual(insert, del);
      });
    }),
    deletes: deletes.filter((del) => {
      return !inserts.some((insert) => {
        return areQuadsEqual(insert, del);
      });
    }),
  };
}

/**
 *
 * @param {QuadLike} quadA
 * @param {QuadLike} quadB
 * @returns {boolean}
 */
function areQuadsEqual(quadA, quadB) {
  // const equal = quad(quadA).equals(quad(quadB));
  const equal =
    quadA.subject.value === quadB.subject.value &&
    quadA.predicate.value == quadB.predicate.value &&
    // We're not consistently using literals in the form-fields addon and helper package, so we force the conversion
    Literal.fromValue(quadA.object).equals(Literal.fromValue(quadB.object)) &&
    quadA.graph.value === quadB.graph.value;

  console.log("comparing", quadA, quadB, equal);

  return equal;
}
