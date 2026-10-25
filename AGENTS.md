# Working in this repo

`PLAN.md` is the plan. Read it before your first task. Nobody owns a part of the app: whoever finds something that needs fixing fixes it, wherever it is.

## Git: only `main`, always current

- Commit only to `main`. Never create branches, never force-push, never rewrite history.
- Run `git pull --rebase origin main` before starting each task and before every commit. Push right after each commit, in small commits.
- Watch `main` for pushes for as long as you're working. Start a background watcher when you begin (in Claude Code, a Monitor running the loop below) and keep it running:

  ```bash
  while true; do
    git fetch -q origin main
    git log --oneline HEAD..origin/main
    sleep 60
  done
  ```

- When new commits appear: pull with rebase, read every changed note addressed to you, run `npm run typecheck`, and fix anything that broke before continuing.

## Notes between people

- The team is Boris, Brendan, Imzihao and David. You're working for whoever your first prompt names, or for the git user if it doesn't name anyone.
- `notes/boris-to-brendan.md` holds notes from Boris to Brendan, and the same pattern covers every pair. `notes/boris-to-everyone.md` holds notes for the whole team.
- Only the sender writes their file. Add each note at the bottom under a `## YYYY-MM-DD HH:MM` heading. Never edit someone else's file; reply in your own file to them.
- Read every `notes/*-to-<you>.md` and `notes/*-to-everyone.md` file when you start and whenever a pull changes one.
- Write a note before you push anything someone else's work depends on: a contract change, a new function to call, a stand-in you're turning off, or a blocker.
- The older files named with letters (`AtoB.md`, `CSOtoD.md`, ...) are history. A was Boris, B Brendan, C Imzihao and D David; CSO, M and P were the sponsor, mesh and readiness survey add-ons.

## The contract

- `convex/schema.ts` and the functions listed in `PLAN.md` under "Contract" are shared. Before changing a shape someone else reads, write a note to everyone it affects. Keep old fields working until nothing reads them.
- Never break a stand-in someone is building against. Turn it off with its switch on the call floor.
- `npm run typecheck && npm run lint` must pass before every push. Cyclomatic complexity over 15 fails lint.

<!-- BEGIN:nextjs-agent-rules -->

## Memory: the team shares one 16 GB laptop

Several sessions run on the same machine, and on a Mac GPU memory comes out of the same RAM. When it runs out, the whole machine freezes: cursor, audio, Bluetooth.

- Reuse the dev server on :3100. Start your own only when you must, and stop it the moment you're done.
- Never open the 3D map in headless Chromium. It draws WebGL on the CPU (SwiftShader), and one tab reached 14 GB. Use a headed browser (`channel: "chrome"`, `headless: false`), take what you need, and close the browser in the same command.
- Open one browser at a time, and close it before you finish a step. Don't leave a Playwright MCP page open between turns.
- Run one heavy command at a time (`tsc`, `next build`, the Python models). Never `npm ci` in a worktree: clone with `cp -cR <main>/node_modules <worktree>/`.
- Map code: every GPU allocation is width × height × bytes. Keep screen targets under the renderer's pixel budget, and release WebGL contexts on dispose (`InkMapRenderer.dispose`).
- No `flat` varyings in any shader. Chrome on a Mac emulates them through Metal by rewriting every draw's index buffer, and the map's GPU process went past 13 GB in two seconds.
- To measure a browser's memory, read the process footprint (`top -stats pid,mem`), not RSS. RSS leaves out GPU memory, and a 14 GB GPU process showed 57 MB of RSS.

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
