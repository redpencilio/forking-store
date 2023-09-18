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
   - when release-it asks to commit, you can update the changelog and add it to the staged changes so it will be part of the same release commit.
   - you can either manually edit the changelog or use lerna-changelog to generate it based on the merged PRs (`GITHUB_AUTH=your-token npx lerna-changelog`).
3. release-it pushes the tag to GitHub
4. Woodpecker will publish the new version to npm
