# ESAP review web port

The executable page is `examples/esap_review.html`. Its 14.22 by 8 world
stage, timing model, formula factory, optional audio adapter, and layout guards
live in this directory. Private production references used during development
are not distributed with the public repository.

Each file in `scenes` owns one of the eight implemented music sections. Together
they produce the complete 12,201-frame, 203.35-second composition. The registry
supplies each scene with:

- an exact section clock driven by absolute beatmap times;
- the central vector `FormulaFactory`, which waits for MathJax before layout;
- the active semantic palette;
- a deterministic per-section random stream; and
- the Player recording scene.

Import `scenes/helpers.ts` for shared starfield and backdrop furniture, title
chips, collision-safe caption placement, palette flashes, and frame-safe
removal. These stay outside the context so scene modules only pay for the
helpers they use.

Visible copy and formula sources must pass `assertVisibleCopy`. Fractions use
LaTeX `\frac`; literal slash and division-sign glyphs are rejected.

Start the local example from the repository root:

```powershell
npm run dev
```

Then open `http://localhost:5173/examples/esap_review.html`.

The public repository intentionally excludes the production soundtrack and
reference video. The visual timeline works without them. To preview with audio
you own or are licensed to use, pass its URL explicitly:

```text
http://localhost:5173/examples/esap_review.html?audio=/media/track.wav
```

The MP4 render script expects a local
`examples/esap-review/assets/audio/full_explainer_bg.wav`; that ignored file
must be supplied separately.

Run the isolated and browser-fidelity checks with:

```powershell
npx tsc -p examples/esap-review/tsconfig.json
npx vitest run --config examples/esap-review/vitest.config.ts
npx playwright test tests/integration/esap-review.spec.ts
```
