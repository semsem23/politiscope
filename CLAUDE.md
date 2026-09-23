# Politiscope — ground rules

Architecture, workflows and full detail live in [README.md](README.md) and
[web/README.md](web/README.md). This file is the standing rules for any
Claude Code session working in this repo — read it first.

## Hard constraints

- **Never modify quote text, source URLs, or anything in
  `politiscope/quotes.py` or `politiscope/publish.py` validation logic.**
  Quote integrity is the core constraint of this project.
- **Never apply migrations to the production database.** Write the
  migration file under `migrations/` and tell the user the command to run
  it (`python -m politiscope.cli db-migrate`, or trigger the `DB Migrate`
  GitHub Action) — they run it, not you.
- **Make one commit per phase**, with a clear message. **Don't push**
  unless explicitly asked.

## After every change, before saying you're done

| Changed | Run |
|---|---|
| Anything under `web/` | `npm --prefix web run typecheck && npm --prefix web run lint && npm --prefix web run build` |
| Anything under `politiscope/` or `tests/` | `python -m pytest tests/ -q` |

Fix failures before reporting the work as finished.

## Other commands worth knowing

```bash
cd web && npm run dev                          # front-end dev server, http://localhost:5173
python -m politiscope.cli selftest             # offline, free sanity check of the whole pipeline
python -m pytest tests/ -q -k regression        # only the tests that replay real past bugs
python -m politiscope.cli fetch-x --dry-run     # estimate ingestion cost/volume, no network call
```
