# MIDDEN

**The village is already built. You are only deciding what survives.**

A reverse town builder. You do not found a settlement — you inherit a buried one, and the map is a **cross-section of earth** seen side-on. Everything is already down there; you just haven't seen it.

Play: **https://midden.vercel.app** *(see Deploy below)*

---

## The hook

Three genre assumptions, broken:

| Assumption | MIDDEN |
| --- | --- |
| You supply the buildings | They are already in the ground. You only choose what to keep. |
| The economy has sources | It is **closed**. Every building you raise is paid for by one you pull apart. |
| The ground is stable | Earth holds itself. **Masonry does not.** Cut the ground out from under what you saved and you will hear it come down. |

## How it plays

- **Clear** soil cell by cell from the surface downward. Clearing costs salvage.
- **Salvage** is the only currency and there is no source but the dig itself. To restore anything you must break something else up.
- **Restore** a fully cleared building and it is scored by the company it keeps — houses want a well, the dead want a chapel, two seats of government quarrel. Buildings touching **across a stratum boundary** score double, for good or ill.
- **Load**: a building stands only while every cell directly beneath it is solid. Open that ground and it is undermined; it groans for one action, then falls — and what falls leaves a void that takes whatever sat on top of it. **Prop** the gap in that one-action window and it survives.
- **Information is partial.** The open face of the trench leaks a seam of masonry where something is buried. A **sounding** drives a thin rod and returns silhouettes — shape and depth, never identity.
- A **restored** building seals the ground beneath it against your own spade. That is the one protection restoring buys you.

### The strata

| Depth | Who | Feel |
| --- | --- | --- |
| Turfline | this season | Root-matted spoil. Nothing sleeps this shallow. |
| The Near Years | your grandmother's people | Brick you recognise. Doorsteps worn by feet you could name. |
| The Reed-Folk | before the vale was drained | Wattle, ash and river silt. They built low and they built wet. |
| The Under-Builders | no one's grandmother | Pale stone, set true, in courses no mason here was taught. |

Recognition at the top, wonder at the bottom — and each layer builds by its own logic.

## Controls

`Q` clear · `W` sounding · `E` prop · `R` restore · `F` break up · right-click inspect · `G` grid · `Esc` deselect

## Running locally

```bash
python -m http.server 5809 -d midden
```

Then open <http://localhost:5809>. No build step, no dependencies, no asset files — the art is drawn to Canvas 2D and the audio is synthesised in WebAudio at runtime.

## Layout

```
index.html        screens: title, intro, game, end, modals
css/style.css     field-notebook UI
js/content.js     strata, building catalogue, affinity table, economy, copy
js/world.js       seeded trench generation; solidity vs passability
js/game.js        rules engine — actions, collapse, coherence (no DOM)
js/render.js      painterly cross-section renderer
js/audio.js       procedural SFX + ambience
js/main.js        boot, screens, input, loop, headless harness
```

`js/game.js` is deliberately free of rendering and DOM so it can be driven headlessly.

## Balance harness

From the browser console:

```js
MIDDEN.sim(25)        // 25 full headless runs of a bot policy → score distribution
MIDDEN.step(50)       // advance the visible game 50 bot actions
MIDDEN.coherence()    // current score breakdown, including every scoring pair
MIDDEN.render()       // force one frame (rAF is throttled in hidden tabs)
```

Grades are calibrated against 25 headless runs of an unclustered policy: median **25**, p75 **34**. Deliberate cluster play should clear 45.

⚠️ The bot does not plan clusters, so `sim()` **understates** adjacency scoring (it contributes ~1 of ~26). It is a check that the engine terminates, that restoring is affordable, and that collapses fire — not a measure of the skill ceiling. Balance beyond that needs a human.

## Deploy

Static; no build.

```bash
vercel --prod --yes
```
