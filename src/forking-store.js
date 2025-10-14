import {
  Store,
  parse,
  serialize,
  Fetcher,
  UpdateManager,
  namedNode,
  Statement,
} from "rdflib";

const BASE_GRAPH_STRING = "http://mu.semte.ch/libraries/rdf-store";

export default class ForkingStore {
  internalStore = new Store();
  graph = this.internalStore; // Deprecated, remove in next major
  fetcher = null;
  updater = null;
  observers = new Map();
  #callbackBatcher = null;

  constructor() {
    this.fetcher = new Fetcher(this.internalStore);
    this.updater = new UpdateManager(this.internalStore);
    this.#callbackBatcher = new NotifyObserverBatcher((data) => {
      informObservers(data, this);
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
    parse(content, this.internalStore, graphValue, format);
    if (additions) {
      parse(additions, this.internalStore, additionGraphFor(graph).value, format);
    }
    if (removals) {
      parse(removals, this.internalStore, deletionGraphFor(graph).value, format);
    }
  }

  serializeDataWithAddAndDelGraph(graph, format = "text/turtle") {
    return {
      graph: serialize(graph, this.internalStore, format),
      additions: serialize(additionGraphFor(graph), this.internalStore, format),
      removals: serialize(deletionGraphFor(graph), this.internalStore, format),
    };
  }

  serializeDataMergedGraph(graph, format = "text/turtle") {
    return serialize(this.mergedGraph(graph), this.internalStore, format);
  }

  /**
   * Parses content from a file into a specified graph.
   */
  parse(content, graph, format) {
    const graphValue = graph.termType == "NamedNode" ? graph.value : graph;
    parse(content, this.internalStore, graphValue, format);
  }

  /**
   * Perform a match on the graph.
   */
  match(subject, predicate, object, graph) {
    if (graph) {
      const mainMatch = this.internalStore.match(subject, predicate, object, graph);
      const addMatch = this.internalStore.match(
        subject,
        predicate,
        object,
        additionGraphFor(graph),
      );
      const delMatch = this.internalStore.match(
        subject,
        predicate,
        object,
        deletionGraphFor(graph),
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

      return this.internalStore.match(subject, predicate, object);
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

  /** @param {Statement[]} inserts */
  addAll(inserts) {
    for (const ins of inserts) {
      this.internalStore.add(statementInGraph(ins, additionGraphFor(ins.graph)));
      try {
        // If the statement was in the deletion graph, remove it from there
        this.internalStore.remove(statementInGraph(ins, deletionGraphFor(ins.graph)));
      } catch (e) {
        // this is okay!  the statement may not exist
      }
    }

    this.#callbackBatcher.addData({ inserts });
  }

  /** @param {Statement[]} deletes */
  removeStatements(deletes) {
    for (const del of deletes) {
      this.internalStore.add(statementInGraph(del, deletionGraphFor(del.graph)));
      try {
        // If the statement was in the addition graph, remove it from there
        this.internalStore.remove(statementInGraph(del, additionGraphFor(del.graph)));
      } catch (e) {
        // this is okay!  the statement may not exist
      }
    }

    this.#callbackBatcher.addData({ deletes });
  }

  removeMatches(subject, predicate, object, graph) {
    const matches = this.internalStore.match(subject, predicate, object, graph);
    this.internalStore.removeStatements(matches);
  }

  allGraphs() {
    const graphStatements = this.internalStore.match().map(({ graph }) => graph.value);

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
    const delSource = deletionGraphFor(graph);
    const addSource = additionGraphFor(graph);

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
    this.internalStore.removeMatches(null, null, null, mergedGraph);
    // add baseContent
    baseContent.forEach((statement) => this.internalStore.add(statement));
    // remove stuff
    delContent.forEach((statement) => {
      try {
        this.internalStore.remove(statement);
      } catch (e) {
        /* */
      }
    });
    // add stuff
    addContent.forEach((statement) => this.internalStore.add(statement));

    return mergedGraph;
  }

  async pushGraphChanges(graph) {
    const deletes = this.match(null, null, null, deletionGraphFor(graph)).map(
      (statement) => statementInGraph(statement, graph),
    );

    const inserts = this.match(null, null, null, additionGraphFor(graph)).map(
      (statement) => statementInGraph(statement, graph),
    );

    try {
      await this.update(deletes, inserts);
    } finally {
      this.removeMatches(null, null, null, deletionGraphFor(graph));
      this.removeMatches(null, null, null, additionGraphFor(graph));
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
}

/**
 * @deprecated "add" could refer to the verb or the noun in this case, confusing! 
 * Use the {@link additionGraphFor} method
 */
export function addGraphFor(graph) {
  return additionGraphFor(graph);
}

/**
 * Yields the graphs which contains additions.
 */
export function additionGraphFor(graph) {
  const graphValue = graph.termType == "NamedNode" ? graph.value : graph;
  const base = `${BASE_GRAPH_STRING}/graphs/add`;
  const graphQueryParam = encodeURIComponent(graphValue);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

/**
 * @deprecated "del" could refer to the verb or the noun in this case, confusing! 
 * Use the {@link additionGraphFor} method
 */
export function delGraphFor(graph) {
  return deletionGraphFor(graph)
}

/**
 * Yields the graph which contains removals.
 */
export function deletionGraphFor(graph) {
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

  /**
   * @param {(data: { inserts: Statement[], deletes: Statement[]}) => void} dataHandler
   */
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
