# Working in this repo

`PLAN.md` is the plan. Read it before your first task, and read the section for your track closely. Your track (A, B, C or D) is named in your first prompt; if it isn't, ask before writing code.

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

- When new commits appear: pull with rebase, read every changed note addressed to your track, run `npm run typecheck`, and fix anything of yours that broke before continuing.

## Notes between tracks

- `notes/AtoB.md` holds notes from Track A to Track B, and the same pattern covers every pair (`BtoC.md`, `DtoA.md`, ...).
- Only the sending track writes its file. Add each note at the bottom under a `## YYYY-MM-DD HH:MM` heading. Never edit another track's file; reply in your own file to that track.
- Read every `notes/*to<YourTrack>.md` file when you start and whenever a pull changes one.
- Write a note before you push anything another track depends on: a contract change, a new function they should call, a stand-in you're turning off, or a blocker.

## The contract

- `convex/schema.ts` and the functions listed in `PLAN.md` under "Contract" are shared. Change only the tables your track owns, and write a note to every reading track first. Keep old fields working until the readers confirm.
- Never break a stand-in another track builds against. Turn yours off with its switch on the call floor.
- `npm run typecheck && npm run lint` must pass before every push. Cyclomatic complexity over 15 fails lint.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
