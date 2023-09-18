# forking-store

Forking store that works with both front-end js(ember) and back-end js(node with babel)

`npm install forking-store`

## development

Clone the repo.

Edit ./forking-store.js and link/install with npm inside your project.

When it gets included in your project it should automatically build the browser and node versions.

## Releasing

1. run `npm run release`
2. follow the release-it prompts
3. release-it pushes the tag to GitHub
4. Woodpecker will publish the new version to npm
