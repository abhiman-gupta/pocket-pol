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

The web build focuses on Pollia's interactive Cornell box, one Jarecki material model, and image and channel exports. Native Mitsuba and Pollia can serve as references for numerical comparisons. Pollia's source and license are credited in this directory. The material model is described by [Quinn Jarecki and Meredith Kupinski](https://arxiv.org/abs/2307.11976).
