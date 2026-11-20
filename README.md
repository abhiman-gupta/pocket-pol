# Pocket Pol

A physically based polarization renderer that runs entirely in your browser. No downloads. No command line.

**Pocket Polarization** works on desktop and phone. Change the light's polarization, rotate an analyzer, and inspect intensity and the Stokes channels of a Cornell box rendered with WebGPU (with a CPU fallback).

**Try it:** https://pocket-pol.abhimangupta.com

The app lives in [`web/`](web/). See [`web/README.md`](web/README.md) for running it locally and for the headless renderer.

## Credits

Pocket Pol follows [Pollia](https://github.com/cmtribble3/pollia) (by cmtribble3, abhiman-gupta, and kupinski) for its interface, Jarecki material model, and Mueller transport, and PolRay for its starting scene. It builds on [Mitsuba 3](https://github.com/mitsuba-renderer/mitsuba3)'s Cornell box scene; Mitsuba's license and preferred citation ship in [`web/LICENSE`](web/LICENSE) and [`web/mitsuba3.bib`](web/mitsuba3.bib). Full credits are on the site's [credits page](https://pocket-pol.abhimangupta.com/credits.html).
