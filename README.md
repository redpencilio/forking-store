# forking-store

Forking store that works with both front-end js(ember) and back-end js(node with babel)

`npm install forking-store`

This library is built on top of [rdflib.js](https://github.com/linkeddata/rdflib.js)

## API

### ForkingStore Class

#### constructor

Returns a new ForkingStore

```
constructor ForkingStore(): ForkingStore
```

#### load

Resolves the `source` URI to a web resource and loads that data into this store. If an array of resources is given, they will be fetched in parallel.

```
load(source: string | NamedNode | (string | NamedNode)[]): Promise<void>
```

#### loadDataWithAddAndDelGraph

Parses data from the specified `content`, `additions` and `removals` strings (containing RDF) into this store. The data is structured in `format` mimeType (text/turtle by default) and is parsed into `graph`.

```
loadDataWithAddAndDelGraph(content: string, graph: string | NamedNode, additions: string, removals: string, format: string?): void
```

#### serializeDataWithAddAndDelGraph

Returns the `graph` and its corresponding additions and removals graphs in the specified `format` (text/turtle by default).

```
serializeDataWithAddAndDelGraph(graph: NamedNode, format?: string): {
    graph: string | undefined;
    additions: string | undefined;
    removals: string | undefined;
}
```

#### serializeDataMergedGraph

Returns the data that remains after applying additions and deletes to `graph` in the specified `format` (text/turtle by default).

```
serializeDataMergedGraph(graph: string | NamedNode, format?: string): string | undefined
```

#### parse

Parses data from the specified `content` string (containing RDF) into this store. The data is structured in `format` mimeType (text/turtle by default) and is parsed into `graph`.

```
parse(content: string, graph: string | NamedNode, format?: string): void
```

#### match

Returns the statements that match the pattern `subject`, `predicate`, `object` and `graph`.

One or multiple of the terms of the triple can be set to `null` or `undefined`, turning them into wildcards. They will now match any value, e.g. `match(null, FOAF('knows'), null, null)` will match any person that knows someone. If we want to be more restrictive, we can say: `match(null, FOAF('knows'), PERSON('John'), null)` so that only the people that know John are returned. We can optionally specify the graph, e.g. `match(null, FOAF('knows'), PERSON('John'), profile)` so that only the people that know John according to my profile are returned.

```
match(subject: Quad_Subject | null, predicate: Quad_Predicate | null, object: Quad_Object | null, graph: string | NamedNode): Statement[]
```

#### any

Returns the wildcard value of a triple matching the pattern `subject`, `predicate`, `object` and `graph`, or undefined if no match was found. If all arguments are specified and a match is found, true is returned.

One term of the triple can be set to `null` or `undefined`, serving as a wildcard. They will now match any value, e.g. `any(null, FOAF('knows'), PERSON('John'), null)` will match any person that knows John and `any(me, FOAF('knows'), null, null)` will match any person that I know. We can optionally specify the graph, e.g. `any(null, FOAF('knows'), PERSON('John'), profile)` so that only the people that know John according to my profile are returned.

```
any(subject: Quad_Subject | null, predicate: Quad_Predicate | null, object: Quad_Object | null, graph: string | NamedNode): NamedNode | boolean | undefined
```

#### addAll

Adds all given `inserts` statements to the store.

```
addAll(inserts: Statement[]): void
```

#### removeStatements

Deletes all given `deletes` statements from the store.

```
removeStatements(deletes: Statement[]): void
```

### removeMatches

Deletes the statements matching the pattern `subject`, `predicate`, `object` and `graph`. The matching happens in the same way as in the `match` method.

```
removeMatches(subject: Quad_Subject | null, predicate: Quad_Predicate | null, object: Quad_Object | null, graph: Quad_Graph | null): void
```

## Development

Clone the repo.

Edit ./forking-store.js and link/install with npm inside your project.

When it gets included in your project it should automatically build the browser and node versions.

## Releasing

1. run `npm run release`
2. follow the release-it prompts
   - when release-it asks to commit, you can update the changelog and add it to the staged changes so it will be part of the same release commit.
   - you can either manually edit the changelog or use lerna-changelog to generate it based on the merged PRs (`GITHUB_AUTH=your-token npx lerna-changelog`).
3. release-it pushes the tag to GitHub
4. Woodpecker will publish the new version to npm
