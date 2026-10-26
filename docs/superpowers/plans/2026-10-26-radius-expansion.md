# Search radius expansion implementation plan

> **For agentic workers:** Use superpowers:executing-plans; independent server and browser test work follows dispatching-parallel-agents.

**Goal:** Complete the existing Claude draft against `shared/API.md` v0.7 and `cctv 최종.md` §6.2.
**Architecture:** Keep the stored radius unchanged. Search approved online demo webcams in 100m increments; use the final radius only for this analysis. Surface the recorded search and event in the existing UI.
**Tech stack:** FastAPI/Pydantic, pytest, Next.js/React/TypeScript, Playwright CLI.

## Constraints and review focus

- Preserve the four existing uncommitted draft files; no A, external CCTV video, production DB writes, credentials output, or unrelated refactors.
- Default two expansions, integer 0–5, maximum 5000m; stop at the first matching webcam.
- Legacy results/parameters must still render; stale analyses must not show expansion as current.
- Automatic expansion must not trigger the warning intended for a manually changed report radius.
- Nearby metadata remains explicit about current report versus analysis radius.
- Restart the authorized 8000/3000 processes only after an idle status and successful tests/build; leave Expo/Tailscale alone.

## Tasks

- [x] Review draft and add temporary-DB pipeline/guidance tests for attempts, event, outcome, caution, unchanged radius, ranking, limits and defaults.
- [x] Add browser regression checks before UI implementation; preserve all existing checks.
- [x] Extend API types, merge legacy analysis parameters with defaults, validate the 0–5 input, show expansion, and render the amber EXPAND event.
- [x] Run full pytest, tsc, eslint and build; restart with the supplied script after checking idle status.
- [x] Run response/guidance/wall synthetic browser checks, inspect both viewport captures, and correct any defects.
- [x] Review the complete diff, record actual verification in STATUS, stage only task files, commit with coauthor, push work/b-app and verify remote.
