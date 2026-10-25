# Video

## Screen recordings of the live app

`npm run record` (from the repo root) films the app running the Eaton Fire night in west Altadena on its own throwaway stack: a local Convex backend on :3330, the OR-Tools solver on :8899 and a production build on :3340, never the team's deployment and never a real phone. It rebuilds the app first, so a restyle or a new fire model on `main` shows up on the next run. Each scene seeds 1,000 census households on a fresh backend, drives the night through Convex functions and the sim clock, films headed Chrome on the GPU (it refuses software WebGL and stops when free memory falls under 25%), then stops everything before ffmpeg writes `video/recordings/<clip>-<wide|tall>.mp4`, a contact sheet per clip and `index.md`. Scene names are in `scripts/record/scenes.ts`.

```bash
npm run record                        # every scene
npm run record -- driver night        # only these scenes
npm run record -- --skip-build census # reuse the last build
```
