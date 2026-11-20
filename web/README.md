# Pocket Pol

Pocket Polarization is a lightweight, physically based renderer for exploring polarized light in your browser, with no software to install. In the Cornell box, you can change the source polarization, rotate a virtual analyzer, and inspect intensity and the Stokes channels to see how light and surfaces affect the result.

The interface follows Pollia's Swift window and Cornell box. The renderer uses Pollia's Jarecki material parameters, Mueller transport, display filters, and color maps. A WebGPU compute shader accelerates rendering, with a JavaScript CPU fallback. [Pollia source, revision `a8c7d7ea`](https://github.com/cmtribble3/pollia/tree/a8c7d7eaa55c20473a20f63de5986fc7f29e77d7)

## Interactive window

Serve this directory from the repository root and open http://127.0.0.1:8000.

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory web
```

Choose RGB or monochrome polarized channels. The browser renders at 512 × 512 pixels and defaults to 64 samples per pixel, or 8 when it falls back to the CPU renderer; the headless renderer also accepts 128 × 128 and 256 × 256. **Fresh render** starts from zero and progressively accumulates the selected number of samples per pixel. The initial render uses the same sample count shown in the controls. The same button becomes **Stop** during rendering and keeps the partial estimate when pressed. Display filters, exposure, analyzer angle, color map, and range operate on the accumulated result. Drag to orbit the camera around the Cornell box. The viewport updates with a one-sample render at half resolution on WebGPU, or at most 64 × 64 on CPU. A fresh render at the selected resolution and sample count starts on release. Display zoom only magnifies the image on screen and never changes the render. Below the image, **Re-render** on the left applies changed scene settings and stands out when there are edits to apply, and **Reset camera** on the right restores the default view. Camera distance needs a fresh render. 

The browser selects hardware WebGPU automatically. Append `?stats` to the app URL to show the active renderer, timings, and any GPU fallback note. The CPU fallback runs in a worker. To compare on the same device, append `?backend=cpu` to the app URL.

The headless renderer exports PNGs, raw Stokes channels, and their JSON metadata.

## Headless rendering

Run from the repository root with Node.js 20 or newer.

```sh
node web/render.mjs --scene cornell --size 512 --channels rgb --spp 256 --out cornell
```

The command writes `cornell.png`, `cornell.f32`, and `cornell.f32.json`. CPU renders use up to eight workers by default. Use `--backend cpu --workers 1` to run a single CPU thread, or `--help` for other options.

For hardware acceleration in Node.js, install the optional Dawn binding and select WebGPU. The CLI uses it automatically when it is installed and a hardware adapter is available. [Dawn’s Node WebGPU documentation](https://github.com/dawn-gpu/node-webgpu)

```sh
npm install --no-save --package-lock=false webgpu@0.6.2
node web/render.mjs --backend webgpu --scene cornell --size 512 --spp 256 --out cornell
```

The GPU and CPU paths use the same sampling sequence and film format. Floating-point rounding can differ across GPU and CPU renders.

## Hosting

GitHub Pages serves the public app at [pocket-pol.abhimangupta.com](https://pocket-pol.abhimangupta.com) from the root of the `gh-pages` branch. Publish the static browser assets from `web/` and keep the deployment branch's `CNAME` and `.nojekyll` files. Every relative module import, the worker and shader URLs, and the stylesheet and script links in `index.html` and `credits.html` share one `?v=` cache-busting number. Raise it everywhere at once before publishing a change:

```sh
perl -pi -e 's/\?v=\d+/?v=34/g' web/*.mjs web/*.html
``` The headless command runs from the source branch.

## Credits and citation

- **Mitsuba 3** provides the upstream source history and Cornell box scene. Wenzel Jakob created Mitsuba at EPFL's Realistic Graphics Lab. Its software citation credits Wenzel Jakob, Sébastien Speierer, Nicolas Roussel, Merlin Nimier-David, Delio Vicini, Tizian Zeltner, Baptiste Nicolet, Miguel Crespo, Vincent Leroy, and Ziyi Zhang. Thank you to the wider Mitsuba community for its contributions. [Upstream project and citation](https://github.com/mitsuba-renderer/mitsuba3#about) · [Contributors](https://github.com/mitsuba-renderer/mitsuba3/graphs/contributors)
- **Pollia** is developed by `cmtribble3`, `abhiman-gupta`, and `kupinski` on GitHub. It is the direct reference for the Swift window and for the Jarecki materials, polarized light source, and Mueller transport adapted to JavaScript. Its nylon parameters and color tables come from **PolRay**. [Pollia source, revision `a8c7d7ea`](https://github.com/cmtribble3/pollia/tree/a8c7d7eaa55c20473a20f63de5986fc7f29e77d7)
- **Quinn Jarecki and Meredith Kupinski** developed the depolarizing Mueller BRDF model used in Pocket Pol. [Efficient Modeling of Depolarizing Mueller BRDFs](https://arxiv.org/abs/2307.11976)

For research that uses Mitsuba 3, see the [upstream software citation in BibTeX](./mitsuba3.bib). The [full upstream license](./LICENSE) ships with the browser distribution.
