# Pocket Pol

A physically based polarization renderer that runs entirely in your browser.

**Pocket Polarization** works on desktop and phone. Change the light's polarization, rotate an analyzer, and inspect intensity and the Stokes channels of a Cornell box rendered with WebGPU (with a CPU fallback).

**Try it:** https://pocket-pol.abhimangupta.com

The app lives in [`web/`](web/). See [`web/README.md`](web/README.md) for running it locally and for the headless renderer.

## Browser-based full-Stokes polarized path tracer

- Each path carries a Stokes vector (I, Q, U, V) per color channel and multiplies 4 × 4 Mueller matrices at every bounce, on both the WebGPU renderer and the CPU fallback.
- Full polarization states: circular as well as linear polarization, partially polarized light (degree of polarization below 100%), and ellipticity.
- Path tracing with next-event estimation and multiple importance sampling, using the published Jarecki material model as implemented in Pollia.
- Runs in the browser on desktop and phone with nothing to install.
- Polarized light sources, a linear analyzer, DoP, AoLP, ellipticity, and Stokes image views, and float32 Stokes export.

## Credits

Pocket Pol brings the polarization models of [Pollia](https://github.com/cmtribble3/pollia) to the browser. Pollia is a research renderer for polarized light transport, built as a fork of [Mitsuba 3](https://github.com/mitsuba-renderer/mitsuba3) and developed by Charlie Tribble, Abhiman Gupta, and Matthew Kupinski. Pocket Pol adapts Pollia's interactive window, its implementation of the Jarecki material model, its polarized emitter and Mueller transport, and its display filters and color maps.

- **Mitsuba 3**, created by Wenzel Jakob at EPFL's Realistic Graphics Lab, is the foundation Pollia builds on. Pocket Pol's Cornell box geometry also follows Mitsuba's Cornell box scene. Its preferred citation ships in [`web/mitsuba3.bib`](web/mitsuba3.bib).
- **PolRay** supplied the default Cornell box layout and reflectances and Pollia's nylon material parameters and color tables.
- **The Jarecki material model** comes from Quinn Jarecki and Meredith Kupinski, "Efficient Modeling of Depolarizing Mueller BRDFs," [arXiv:2307.11976](https://doi.org/10.48550/arXiv.2307.11976) (2023).

## License

Pocket Pol is released under the [BSD 3-Clause License](LICENSE), © 2026 Abhiman Gupta. Portions adapted from Pollia and Mitsuba 3 remain under Mitsuba's BSD 3-Clause license (© 2017 Wenzel Jakob). [`web/LICENSE`](web/LICENSE), which ships with the site, contains both notices.

Pocket Pol is independent and not affiliated with or endorsed by EPFL or the Mitsuba 3 developers. Full credits are on the site's [credits page](https://pocket-pol.abhimangupta.com/credits.html).
