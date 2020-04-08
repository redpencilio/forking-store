# forking-store
forking store that works with both front-end js(ember) and back-end js(node with babel)

`npm install forking-store`

## development
Clone the repo.

Edit ./forking-store.js and link/install with npm inside your project.

When it gets included in your project it should automatically build the browser and node versions.

`npm publish` if you want to update the npm package (requires npm rights).
## how it works
The build script which can be found in package.json babel transpiles the code written in forking-store.js and places it in both ./back-end and ./front-end folders.

./bakck-end and ./front-end folders are entrypoints for npm "main" and "browser" respectively (defined in package.json).

Their main difference is that they use rdflib and browser-rdflib respectively.

The prepublish script in package.json will be ran before publishing as well as when npm installing.
