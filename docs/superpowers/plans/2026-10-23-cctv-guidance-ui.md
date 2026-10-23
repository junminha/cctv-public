# CCTV guidance UI implementation plan

> Execute inline with superpowers:executing-plans. The user explicitly requested continuation of the three remaining handoff steps.

**Goal:** Show radius CCTV information, selected cameras and responder guidance in report details and `/live`, then restart the existing B services.

**Architecture:** Add API v0.5 types and one shared client component using the existing authenticated proxy. Fetch current nearby metadata independently of analysis; label historical analysis radius and hide previous-run recommendations during a rerun. Reuse the existing palette and independently scrolling panels, without new dependencies.

**Tech stack:** Existing Next.js 16.4.2, React 19.3, TypeScript and Tailwind 4.

**Spec:** User's pasted handoff (remaining steps 1–3), `shared/API.md` v0.5 and `../cctv 최종.md` §§0,5,14.

## Constraints and review focus

- Public CCTV is metadata only; show source purpose and label place hints as inferred.
- Never expose credentials or modify A, reporter data, approvals or the other checkout.
- Distinguish current radius metadata from analysis snapshots; missing old fields must render safely.
- Test zero results, unavailable API/retry, switching reports with delayed requests, radius updates and reruns.
- Keep 1366/1920 layouts within the viewport and allow content to scroll within the existing panels.

## Task 1 — Connect both screens

- [x] Add `notebook-b/admin-web/tests/guidance-ui.js`, a Playwright CLI browser check using synthetic API/WebSocket responses, and observe the missing heading fail on the existing build.
- [x] Add v0.5 types in `lib/api.ts`; create `components/report-guidance.tsx`; integrate in `report-panel.tsx` and `live-wall.tsx`; add scoped styles in `app/globals.css`.
- [x] Check metadata counts, coordinate/purpose/reason display, video vs metadata recommendations, response priority/steps/contacts/cautions, old analysis fields, empty/error/loading states, report switching and saved radius changes.
- [x] Run TypeScript, ESLint, production build, the browser regression check and the server test suite.

## Task 2 — Run and verify services

- [x] Preserve the main checkout's existing runtime/database/environment paths; restart only the confirmed cctv-app listeners on 8000 and 3000.
- [x] Check health, authenticated nearby access through the proxy, reporter denial and both pages. Browser fixtures do not count as real video verification.
- [x] Update `shared/STATUS.md` and record command results; review changes and make a local commit on `work/b-app`.

## Execution ledger

- Baseline: clean `work/b-app`, `git pull --ff-only` already up to date at `6fa5f82`; existing linked worktree reused.
- Task 1: Missing guidance heading observed RED; final synthetic browser check GREEN on both screens at both desktop sizes, including radius refresh, error/retry, empty/legacy responses, report switching and rerun states. Build and TypeScript pass; lint has zero errors and two pre-existing navigation warnings.
- Final review: independent read-only reviewer found one important issue (prior guidance reappearing after a failed rerun). Added the failed-rerun browser case and observed RED, then applied the latest-request freshness check in report-panel; GREEN including a fresh failed analysis that retains valid guidance. No minor findings.
- Task 2: Final server suite 115/115, health/proxy/pages 200, unauthorized 401, reporter 403. Real-data browser display matches 850m / 191 devices / 95 sites with zero page errors on both screens. Screenshots inspected. Existing reports were not reanalysed.
- Reviewer deferred live health/viewport checks to the executor; the checks immediately above cover both. Changes remain on the existing work/b-app branch; no merge or publication is part of this continuation.
