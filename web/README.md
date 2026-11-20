# Pocket Pol

Pocket Polarization is a lightweight browser renderer for polarized light transport. The first version follows [Pollia](https://github.com/cmtribble3/pollia)'s Swift window and Cornell box at revision `a8c7d7ea`. It uses Pollia's Jarecki material parameters, Mueller transport, display filters, and color maps. The current renderer is a JavaScript port that runs in a browser worker and in Node.js.

## Interactive window

Serve this directory from the repository root and open http://127.0.0.1:8000.

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory web
```

Choose RGB or monochrome polarized channels and 128 × 128 or 256 × 256 pixels. **Fresh Estimate** replaces the current estimate. **Continue** adds the requested SPP when the scene and camera settings match. **Stop** retains the samples from the active batch. Display filters, exposure, analyzer angle, color map, range, and display zoom operate on the accumulated result. Display zoom crops the preview only.

**Save Image** downloads the displayed filter as an sRGB PNG. **Save Channels** downloads a ZIP with the linear, interleaved little-endian float32 film and a JSON sidecar. The sidecar records image shape, channel names, scene settings, seed, total SPP, and sample batches.

## Headless rendering

Run from the repository root with Node.js 20 or newer.

```sh
node web/render.mjs --scene cornell --size 256 --channels rgb --spp 256 --out cornell
```

The command writes `cornell.png`, `cornell.f32`, and `cornell.f32.json`. Run with `--help` for seed and display options. Interactive and headless runs use the same renderer and sample sequence.

## Credits and citation

- **Mitsuba 3** provides the upstream source history and Cornell box scene. Wenzel Jakob created Mitsuba at EPFL's Realistic Graphics Lab. Its software citation credits Wenzel Jakob, Sébastien Speierer, Nicolas Roussel, Merlin Nimier-David, Delio Vicini, Tizian Zeltner, Baptiste Nicolet, Miguel Crespo, Vincent Leroy, and Ziyi Zhang. Thank you to the wider Mitsuba community for its contributions. [Upstream project and citation](https://github.com/mitsuba-renderer/mitsuba3#about) · [Contributors](https://github.com/mitsuba-renderer/mitsuba3/graphs/contributors)
- **Pollia**, by `cmtribble3`, is the direct reference for the Swift window and for the Jarecki materials, polarized light source, and Mueller transport adapted to JavaScript. Its nylon parameters and color tables come from **PolRay**. [Pollia source, revision `a8c7d7ea`](https://github.com/cmtribble3/pollia/tree/a8c7d7eaa55c20473a20f63de5986fc7f29e77d7)
- **Quinn Jarecki and Meredith Kupinski** developed the depolarizing Mueller BRDF model used in Pocket Pol. [Efficient Modeling of Depolarizing Mueller BRDFs](https://arxiv.org/abs/2307.11976)

For research that uses Mitsuba 3, see the [upstream software citation in BibTeX](./mitsuba3.bib). The [full upstream license](./LICENSE) ships with the browser distribution.
