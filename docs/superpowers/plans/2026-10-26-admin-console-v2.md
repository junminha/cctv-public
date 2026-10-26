# Admin console v2 implementation plan

> Execute inline with superpowers:executing-plans; review the final diff independently.

**Goal:** Implement the approved five Figma frames using live API data.
**Architecture:** Retain the console API actions and compact live-wall guidance. Add accessible tabs, scope visual changes to the console, and reuse the existing guidance fetch and log handlers.
**Tech Stack:** Installed Next.js App Router, React, TypeScript, Tailwind CSS, Playwright CLI.
**Spec:** `shared/관리자UI-정리-인수인계.md`, sections 4–5; approved Figma `NCoiCSwtK24eopChRoFtBz`, nodes 44:261/334/407/480/553.

## Global constraints

- Work only in the existing `work/b-app` worktree; no server/API/DB/A changes.
- Do not read credentials, `.env`, or runtime files. Preserve B 8000, Expo and Tailscale.
- Real public CCTV remains map/list metadata only. No example camera values in product code.
- Preserve every action, export, warning and compact `/live` behavior.
- Square corners, token colors, Plex fonts, no horizontal overflow at 1366×768.

## Review focus

- Reanalysis must hide stale recommendations and summary, including failed reanalysis.
- Only step logs at or after this analysis finished can complete its steps; notes/alert acknowledgements cannot.
- Switching reports resets the detail tab; changing tabs preserves unsent memo and tool inputs.
- Empty filters, newly confirmed/closed reports and urgent banner selection must remain reachable.
- Long descriptions, response steps and CCTV names must wrap and scroll within their panel.

## Tasks

- [x] Extend the existing synthetic UI checks before implementation: tabs/keyboard/default tab, next-step advancement, old step logs, filters; retain all old assertions.
- [x] Add shared accessible tabs and list filters; move the unchanged UrgentBanner into the independent top row. Keep the map and detail internally scrollable.
- [x] Organize ReportPanel into response/CCTV/report/tools views. Show a single situation card and the first unfinished response step expanded. Keep nearby detail on numbered map popups and compact `/live` intact.
- [x] Apply console-scoped styling and run `npx tsc --noEmit -p .`, `npx eslint components lib tests`, `npx next build`.
- [x] Run the existing B `python -m pytest -q` (118 baseline). Restart only this worktree's `next start` on port 3000 after checking its process command.
- [x] Run both updated UI scripts and `output/wall-test.js`; inspect 1920×1080 and 1366×768 captures. Fix actual failures, retain assertion coverage.
- [x] Review the final diff and record exact results in `shared/STATUS.md`.
- Finish command sequence: add only owned files, commit with the required coauthor trailer, push `work/b-app`, verify clean status and remote hash.

## Execution record

- Initial worktree clean; latest commit `22c1c25`; `git pull --ff-only`: already up to date.
- Existing linked worktree confirmed; baseline TypeScript check passed.
- Read installed Next.js client component, CSS and production CLI guidance before editing.
- Ruling: use the existing approved plan and execute continuously as requested; no further design approval gate.
- Ruling: completed list filter includes confirmed or closed reports; urgent contains unfinished urgent reports; processing contains all unfinished reports.
- Review fixed queued/no-params analysis start, future-step interaction and stale map ranking. Synthetic guidance also caught radius overwrite from an older snapshot; detail radius now stays authoritative.
- Final checks: TypeScript/build pass, ESLint 0 errors/2 existing warnings, B pytest 118 pass, response 91 pass, guidance 11 pass, live wall 30 scenarios plus selection/auto-follow pass. See STATUS for exact commands and limitations.
