# hamzatamyachte.github.io

Public site: https://hamzatamyachte.github.io/

The home page and every page on this site are generated from `site.json`. Items with a `repo`
are built from that (usually private) repository: the workflow clones it, minifies it and serves it at
`/<path>/`. Items with a `url` are plain links.

## site.json

- `title`, `tagline`: home page header.
- `sections[]`: `id`, `title`, optional `note`, and `items[]`.
- Built item: `repo`, `path`, `name`, `description`, `icon` (relative to the built path).
- Link item: `url`, `name`, `description`, optional `icon`.

## Add a repo-backed item

1. Add it to a section in `site.json`.
2. Give the `SOURCES_TOKEN` secret read access to the repo.
3. Add a workflow to that repo that sends a `source-updated` dispatch to this repo on push,
   using a `SITE_DISPATCH_TOKEN` secret.

## Build locally

    npm ci
    git clone <repo> src/<path>
    npm run build   # output in dist/
