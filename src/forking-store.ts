import {
  graph,
  parse,
  serialize,
  Fetcher,
  UpdateManager,
  namedNode,
  Statement,
  Node,
  NamedNode,
  isNamedNode
} from "rdflib";
import { Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph, Quad } from "rdflib/lib/tf-types.js";
import { GraphType } from "rdflib/lib/types.js";

const BASE_GRAPH_STRING = "http://mu.semte.ch/libraries/rdf-store";

export default class ForkingStore {
  graph = graph();
  fetcher: Fetcher; // TODO: this doesn't seem to be used?
  updater: UpdateManager;
  observers = new Map<string | ((data: Data) => void), (data: Data) => void>();
  #callbackBatcher: NotifyObserverBatcher;

  constructor() {
    this.fetcher = new Fetcher(this.graph);
    this.updater = new UpdateManager(this.graph);
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
    graph: NamedNode | string,
    additions: string,
    removals: string,
    format: string,
  ) {
    const graphValue = isNamedNode(graph) ? graph.value : graph;
    parse(content, this.graph, graphValue, format);
    if (additions) {
      parse(additions, this.graph, addGraphFor(graph).value, format);
    }
    if (removals) {
      parse(removals, this.graph, delGraphFor(graph).value, format);
    }
  }

  serializeDataWithAddAndDelGraph(graph: NamedNode, format = "text/turtle") {
    return {
      graph: serialize(graph, this.graph, format),
      additions: serialize(addGraphFor(graph), this.graph, format),
      removals: serialize(delGraphFor(graph), this.graph, format),
    };
  }

  serializeDataMergedGraph(graph: NamedNode, format = "text/turtle") {
    return serialize(this.mergedGraph(graph), this.graph, format);
  }

  /**
   * Parses content from a file into a specified graph.
   */
  parse(content: string, graph: NamedNode | string, format: string) {
    const graphValue = isNamedNode(graph) ? graph.value : graph;
    parse(content, this.graph, graphValue, format);
  }

  /**
   * Perform a match on the graph.
   */
  match(
    subject?: Quad_Subject | null,
    predicate?: Quad_Predicate | null,
    object?: Quad_Object | null,
    graph?: NamedNode | null,
  ) {
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
        .reduce((acc: Statement[], quad) => {
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
    subject?: Quad_Subject,
    predicate?: Quad_Predicate,
    object?: Quad_Object,
    graph?: Quad_Graph,
  ) {
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

  addAll(inserts: Statement[]) {
    for (const ins of inserts) {
      this.graph.add(statementInGraph(ins, addGraphFor(ins.graph)));
      try {
        // NOTE why do we try removing the statement after adding it?
        this.graph.remove(statementInGraph(ins, delGraphFor(ins.graph)));
      } catch (e) {
        // this is okay!  the statement may not exist
      }
    }

    this.#callbackBatcher.addData({ inserts });
  }

  removeStatements(deletes: Statement[]) {
    for (const del of deletes) {
      this.graph.add(statementInGraph(del, delGraphFor(del.graph)));
      try {
        this.graph.remove(statementInGraph(del, addGraphFor(del.graph)));
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
    const matches = this.graph.match(subject, predicate, object, graph);
    this.graph.removeStatements(matches);
  }

  allGraphs() {
    const graphStatements = this.graph.match().map(({ graph }) => graph.value);

    return new Set(graphStatements);
  }

  changedGraphs() {
    const forGraphs = new Set<string>();
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

  mergedGraph(graph: NamedNode) {
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

  async pushGraphChanges(graph: NamedNode | string) {
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
  update(deletes: Statement[], inserts: Statement[]) {
    return new Promise((resolve, reject) => {
      // @ts-expect-error: I think this code is wrong, but don't want to change it to fix the types in case I break something.
      // TODO: find out if this is used somewhere and remove it if it isn't.
      this.updater.update(deletes, inserts, resolve, reject);
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
 * Yields the graphs which contains additions.
 */
export function addGraphFor(graph: NamedNode | string) {
  const graphValue = isNamedNode(graph) ? graph.value : graph;
  const base = `${BASE_GRAPH_STRING}/graphs/add`;
  const graphQueryParam = encodeURIComponent(graphValue);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

/**
 * Yields the graph which contains removals.
 */
export function delGraphFor(graph: NamedNode | string) {
  const graphValue = isNamedNode(graph) ? graph.value : graph;
  const base = `${BASE_GRAPH_STRING}/graphs/del`;
  const graphQueryParam = encodeURIComponent(graphValue);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

function mergedGraphFor(graph: NamedNode | string) {
  const graphValue = isNamedNode(graph) ? graph.value : graph;
  const base = `${BASE_GRAPH_STRING}/graphs/merged`;
  const graphQueryParam = encodeURIComponent(graphValue);
  return namedNode(`${base}?for=${graphQueryParam}`);
}

function statementInGraph(quad: Statement, graph: GraphType) {
  return new Statement(quad.subject, quad.predicate, quad.object, graph);
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

type Data = { inserts: Statement[]; deletes: Statement[] };

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
    this.#dataHandler = dataHandler;
  }

  // Used by the test helper
  get isIdle() {
    return !this.#batchTimeoutId;
  }

  #reset() {
    this.#pendingDataChanges = { inserts: [], deletes: [] };
    this.#batchTimeoutId = null;
  }

  #ensureBatch() {
    if (!this.#batchTimeoutId) {
      // We use a timeout delay of 0 so the callback runs as soon as possible while still waiting for all synchronous data changes
      this.#batchTimeoutId = setTimeout(() => {
        this.#dataHandler(this.#pendingDataChanges);
        this.#reset();
      });
    }
  }

  addData({ inserts = [], deletes = [] }: Partial<Data>) {
    this.#ensureBatch();

    this.#pendingDataChanges.inserts.push(...inserts);
    this.#pendingDataChanges.deletes.push(...deletes);
  }
}
