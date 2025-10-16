import {
  quad,
  Store,
  parse,
  serialize,
  Fetcher,
  UpdateManager,
  namedNode,
  NamedNode,
  Node,
  isNamedNode,
  Statement,
} from "rdflib";
import {
  Quad,
  Quad_Graph,
  Quad_Object,
  Quad_Predicate,
  Quad_Subject,
} from "rdflib/lib/tf-types";

type Data = { inserts: Quad[]; deletes: Quad[] };

const BASE_GRAPH_STRING = "http://mu.semte.ch/libraries/rdf-store";

export default class ForkingStore {
  internalStore: Store = new Store();

  /**
   * @deprecated Use `internalStore` instead. Will be removed in the next major release.
   */
  graph: Store = this.internalStore;

  fetcher: Fetcher;
  updater: UpdateManager;
  observers = new Map<string | ((data: Data) => void), (data: Data) => void>();
  #callbackBatcher: NotifyObserverBatcher;

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
  async load(source: string) {
    // TODO: should we remove our changes when a graph is being reloaded?
    await this.fetcher.load(source);
  }

  loadDataWithAddAndDelGraph(
    content: string,
    graph: Quad_Graph,
    additions: string,
    removals: string,
    format: string,
  ) {
    parse(content, this.internalStore, graph.value, format);
    if (additions) {
      parse(
        additions,
        this.internalStore,
        additionGraphFor(graph).value,
        format,
      );
    }
    if (removals) {
      parse(
        removals,
        this.internalStore,
        deletionGraphFor(graph).value,
        format,
      );
    }
  }

  serializeDataWithAddAndDelGraph(graph: NamedNode, format = "text/turtle") {
    return {
      graph: serialize(graph, this.internalStore, format),
      additions: serialize(additionGraphFor(graph), this.internalStore, format),
      removals: serialize(deletionGraphFor(graph), this.internalStore, format),
    };
  }

  serializeDataMergedGraph(graph: NamedNode, format = "text/turtle") {
    return serialize(this.mergedGraph(graph), this.internalStore, format);
  }

  /**
   * Parses content from a file into a specified graph.
   */
  parse(content: string, graph: NamedNode | string, format: string) {
    const graphValue = isNamedNode(graph) ? graph.value : graph;
    parse(content, this.internalStore, graphValue, format);
  }

  /**
   * Perform a match on the graph.
   */
  match(
    subject?: Quad_Subject | null,
    predicate?: Quad_Predicate | null,
    object?: Quad_Object | null,
    graph?: Quad_Graph | null,
  ) {
    if (graph) {
      const mainMatch = this.internalStore.match(
        subject,
        predicate,
        object,
        graph,
      );
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
        .reduce((acc: Quad[], quad) => {
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
  equalTriples(a: Quad, b: Quad) {
    return (
      a.subject.equals(b.subject) &&
      a.predicate.equals(b.predicate) &&
      a.object.equals(b.object)
    );
  }

  /**
   * Perform any match on the graph.
   */
  any(
    subject?: Quad_Subject | null,
    predicate?: Quad_Predicate | null,
    object?: Quad_Object | null,
    graph?: Quad_Graph | null,
  ): true | undefined | Node | Quad_Object {
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

  addAll(inserts: Quad[]) {
    for (const ins of inserts) {
      // Only add if the graph does not have it already
      if (!this.internalStore.holdsStatement(ins)) {
        this.internalStore.add(
          statementInGraph(ins, additionGraphFor(ins.graph)),
        );
      }
      try {
        // If the statement was in the deletion graph, remove it from there
        this.internalStore.remove(
          statementInGraph(ins, deletionGraphFor(ins.graph)),
        );
      } catch (e) {
        // this is okay!  the statement may not exist
      }
    }

    this.#callbackBatcher.addData({ inserts });
  }

  removeStatements(deletes: Quad[]) {
    for (const del of deletes) {
      if (this.internalStore.holdsStatement(del)) {
        this.internalStore.add(
          statementInGraph(del, deletionGraphFor(del.graph)),
        );
      }
      try {
        // If the statement was in the addition graph, remove it from there
        this.internalStore.remove(
          statementInGraph(del, additionGraphFor(del.graph)),
        );
      } catch (e) {
        // this is okay!  the statement may not exist
      }
    }

    this.#callbackBatcher.addData({ deletes });
  }

  removeMatches(
    subject?: Quad_Subject | null,
    predicate?: Quad_Predicate | null,
    object?: Quad_Object | null,
    graph?: Quad_Graph | null,
  ) {
    const matches = this.internalStore.match(subject, predicate, object, graph);
    this.internalStore.removeStatements(matches);
  }

  allGraphs(): Set<string> {
    const graphStatements = this.internalStore
      .match()
      .map(({ graph }) => graph.value);

    return new Set(graphStatements);
  }

  changedGraphs(): string[] {
    const forGraphs: Set<string> = new Set();
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

  get isDirty(): boolean {
    return this.changedGraphs().length > 0;
  }

  mergedGraph(graph: Quad_Graph) {
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

  async pushGraphChanges(graph: Quad_Graph) {
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
   */
  private update(deletes: Statement[], inserts: Statement[]) {
    return new Promise((resolve, reject) => {
      this.updater.update(deletes, inserts, (uri, success, errorBody) => {
        if (success) {
          resolve(uri);
        } else {
          reject(errorBody);
        }
      });
    });
  }

  /**
   * Registers an observer, optionally with a key.  The observer will
   * be called with objects of the shape { deletes, inserts } for any
   * change that is passed through `this.update`.
   */
  registerObserver(
    observer: (data: Data) => void,
    key: string | ((data: Data) => void),
  ) {
    key = key || observer;
    this.observers.set(key, observer);
  }

  deregisterObserver(key: string) {
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
export function addGraphFor(graph: Quad_Graph) {
  return additionGraphFor(graph);
}

/**
 * Yields the graphs which contains additions.
 */
export function additionGraphFor(graph: Quad_Graph) {
  const base = `${BASE_GRAPH_STRING}/graphs/add`;
  const graphQueryParam = encodeURIComponent(graph.value);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

/**
 * @deprecated "del" could refer to the verb or the noun in this case, confusing!
 * Use the {@link additionGraphFor} method
 */
export function delGraphFor(graph: Quad_Graph) {
  return deletionGraphFor(graph);
}

/**
 * Yields the graph which contains removals.
 */
export function deletionGraphFor(graph: Quad_Graph) {
  const base = `${BASE_GRAPH_STRING}/graphs/del`;
  const graphQueryParam = encodeURIComponent(graph.value);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

function mergedGraphFor(graph: Quad_Graph) {
  const base = `${BASE_GRAPH_STRING}/graphs/merged`;
  const graphQueryParam = encodeURIComponent(graph.value);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

function statementInGraph(statement: Quad, graph: Quad_Graph) {
  return quad(statement.subject, statement.predicate, statement.object, graph);
}

function informObservers(payload: Data, forkingStore: ForkingStore) {
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
  #batchTimeoutId: null | number = null;
  #dataHandler: (data: Data) => void;
  #pendingDataChanges: Data = { inserts: [], deletes: [] };

  constructor(dataHandler: (data: Data) => void) {
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

  addData({ inserts = [], deletes = [] }: Partial<Data>) {
    this.#ensureBatch();

    this.#pendingDataChanges.inserts.push(...inserts);
    this.#pendingDataChanges.deletes.push(...deletes);
  }
}
