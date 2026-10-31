# Project conventions

- All code, identifiers, comments, commit messages and developer docs are in **English**. Only user-facing UI text and the add-on DOCS.md are in Croatian.
- Layout: `src/shared` (HUB-3 logic, types, state/diff shared by server and web), `src/server` (Node `node:http` + `node:sqlite`, no runtime npm dependencies), `src/web` (React UI, bundled into one HTML file), `uplatnice/` (Home Assistant add-on), `scripts/build.mjs`.
- The server only accepts requests from Home Assistant Ingress (172.30.32.2) unless `ALLOW_ANY_CLIENT=1` (development).
- The web client keeps optimistic state and sends minimal operations (`diffState`) to `POST api/ops`; API paths are relative so they work under the Ingress prefix.
- Run `npm test` and `npm run build` before committing. Bump `version` in `uplatnice/config.yaml` and add a CHANGELOG entry for every release.
- PDF417 must follow the HUB-3A spec: 9 data columns, error correction level 4, row height 3 modules, UTF-8 text.
