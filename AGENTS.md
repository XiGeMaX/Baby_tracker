## Go development

Before any Go coding, review, debugging, troubleshooting, or setup task, load the `samber/cc-skills-golang@golang-how-to` skill first — it routes to whichever other Go skills the task needs.

## Runtime

- The application is a Go service. Python is not required at runtime.
- Keep templates and static assets at the repository root so `BABY_TRACKER_WEB_DIR=.` works for local runs.
- Runtime data belongs under `data/` and must not be committed.
- Record user-visible changes in `CHANGELOG.md`.
