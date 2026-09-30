# Games

Public site for small iPhone web games: https://hamzatamyachte.github.io/

The game sources live in private repositories. On every push to a game (or to this repo),
the workflow clones each game listed in `games.json`, minifies it and deploys the result to GitHub Pages.
Each game keeps its own path, for example `/iphone-hanoi/`.

## Add a game

1. Add an entry to `games.json` (`repo`, `path`, `name`, `description`, `icon`).
2. Give the `GAMES_TOKEN` secret read access to the new repo.
3. Add the notify workflow to the game repo so pushes trigger a rebuild.

## Build locally

    npm ci
    git clone <game repo> src/<path>
    npm run build   # output in dist/
