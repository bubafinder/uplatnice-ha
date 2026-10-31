# Project conventions

- Everything visible on GitHub is in **English**: code, identifiers, comments, commit messages, branch names, PR titles and descriptions, review comments, issues, README, DOCS.md, CHANGELOG and add-on metadata. The only Croatian text is the app's user-facing UI strings.
- Layout: `src/shared` (HUB-3 logic, types, state/diff shared by server and web), `src/server` (Node `node:http` + `node:sqlite`, no runtime npm dependencies), `src/web` (React UI, bundled into one HTML file), `uplatnice/` (Home Assistant add-on), `scripts/build.mjs`.
- The server only accepts requests from Home Assistant Ingress (172.30.32.2) unless `ALLOW_ANY_CLIENT=1` (development).
- The web client keeps optimistic state and sends minimal operations (`diffState`) to `POST api/ops`; API paths are relative so they work under the Ingress prefix.
- Run `npm test` and `npm run build` before committing.

## Workflow

- Never push to `main`. Every change goes on a branch (`feat/…`, `fix/…`, `chore/…`) and is opened as a pull request for the owner to review and merge.
- Keep PRs small and focused: one feature or fix per PR. Larger work is split into a sequence of PRs.
- The PR description (in English) explains what changed, why, how it was tested, and what the reviewer should check manually.
- Wait for the owner to confirm the merge before building on top of an unmerged PR. If follow-up work is needed meanwhile, branch from the PR branch and say so in the description.
- Releases: bump `version` in `uplatnice/config.yaml`, add a CHANGELOG entry, merge, then push a tag `vX.Y.Z` matching that version. Only tags publish add-on images, so merged but untagged changes never reach Home Assistant.
- PDF417 must follow the HUB-3A spec: 9 data columns, error correction level 4, row height 3 modules, UTF-8 text.
