# Superstar Scorebook

A phone-friendly scorebook for Challenge Mode batting stats. It runs as a static site, saves on the device immediately, and can copy that history to `data/stats.json` in this repository.

## Publish with GitHub Pages

1. Push this folder to a GitHub repository.
2. Open the repository Settings, then Pages.
3. Deploy from the `main` branch, folder `/` (root).
4. Open the Pages URL on your phone. Add it to the Home Screen if you want it full screen.

## Sync the phone and computer

GitHub Pages cannot store your stats by itself. The page keeps them in the browser, then updates `data/stats.json` when you give it a token.

1. On GitHub, open Settings, then Developer settings, then Fine-grained personal access tokens.
2. Limit the token to this repository only.
3. Set Contents to Read and write.
4. On each phone or computer, open Sync in the scorebook and paste the token once.

The token stays in that browser. It is not written into the repository. If the repository is public, the stats file is public too.

The phone commits `data/stats.json` when you play. Pull that file before you commit other work from a computer, so the two copies do not collide.

## Check the stat math

```bash
node js/selftest.js
```

*git test*
