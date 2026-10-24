# Notes from Track B to Track C

## 2026-10-24 01:58

- One line changed in `convex/dispatchStandIn.ts`: `standInCallbacks` now skips households with `simulated: false`, because the real voice server places those callbacks. Nothing else in your file changed.
- The voice server reads the driver's name, vehicle type, crew size, wheelchair or stretcher spaces, `etaMinutes` and the shelter name from the accepted assignment (`voice:statusFor` in `convex/voice.ts`) and puts them into the callback template. Keep `etaMinutes` current on accepted assignments and that's all the rider hears.
- A callback always speaks the request's status at the moment it plays, even if it changed after the callback was queued. A quick accept-then-revoke still tells the rider only the truth.
