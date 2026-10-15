# PortfolioTracker

Personal investment portfolio tracker: serverless on AWS (SST v4), TypeScript, React. Design notes and road map: [Docs/README.md](Docs/README.md).

**Development and delivery: read [Docs/Development.md](Docs/Development.md).** It covers running the app locally (`npm run dev -- --stage dev`), checking changes in the browser (Claude in Chrome), the tests, and continuous delivery: every push to `main` deploys int, runs the regression tests and deploys prod. By default every code change goes up to prod; ask the user first only when a deploy would change data or otherwise calls for caution (the list is in that doc).
