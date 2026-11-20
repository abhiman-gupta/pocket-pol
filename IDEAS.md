# Pocket Pol Ideas

**Pocket Pol** is short for **Pocket Polarization**. It is a lightweight, physically based renderer for exploring how polarized light behaves, directly in a desktop or phone browser. The goal is to make the basic concepts accessible through a clear, interactive interface that requires no software installation.

The initial scope follows Pollia's Swift window, Cornell box, and Jarecki material. Its headless command renders the same preset at higher samples per pixel and produces files for downstream tools.

## Current starting point

- The initial prototype under `dist/` uses WebGPU and a CPU fallback. Its startup scene came from PolRay.
- The new browser implementation under `web/` uses Pollia's Cornell geometry and renders in a worker. The headless command shares that renderer.

## Feature ideas

- [x] **Scene selection in the control panel.** Put a Scene selector in the Scene tab and offer Cornell Box as the only preset for now.

- [x] **Fresh renders only.** (Formerly Fresh estimates; the button now reads Fresh render.) Start every render at zero and progressively accumulate the selected samples per pixel. Use one button that reads Fresh render when idle and Stop during rendering. Keep the render statistics hidden while retaining the panel and its data updates.

- [x] **Default Cornell box from PolRay.** Open with PolRay’s open-front room, red and green walls, red sphere, rotated white block, square ceiling light, and square camera framing. Use its RGB diffuse reflectance values in Pocket Pol’s RGB renderer.
- [x] **512 × 512 renders at 64 SPP by default.** The browser renders only at 512 × 512 (previously 256 × 256) and the image size control is gone. The headless renderer accepts 128, 256, and 512 and defaults to 512. Fresh renders default to 64 samples per pixel, and the sample presets are 64, 256, and 1024 (the 8 SPP preset is gone). When the browser falls back to the CPU renderer, it drops to 8 SPP the first time, including a render already in progress. On the M5 in the browser with WebGPU, 64 SPP took about 47 ms at 256 × 256 and 135 ms at 512 × 512; 256 SPP took 125 ms and 466 ms. The CPU renderer takes about 0.3 s per sample at 256 × 256 and 1.1 s at 512 × 512, so 8 SPP takes about 9 s there.
- [x] **Pollia layout and exports.** Recreate the Swift sidebar and viewport, with Scene, Statistics, Display, Camera, and Export. Keep float32 Stokes channels with JSON metadata available through the headless renderer.
- [x] **Jarecki materials.** Use Pollia's Jarecki model for the Cornell box with RGB and monochrome channels and fixed Mueller transport.
- [x] **Headless rendering.** Run the default scene as a batch job at user-selected SPP using the same renderer as the browser.
- [x] **Fast rendering.** Prefer hardware WebGPU for interactive rendering. Support the same shader in headless mode through Dawn and parallel CPU rendering where GPU access is unavailable. Benchmark both speed and agreement with the CPU Stokes channels.
- [ ] **Measure time to accurate Stokes output.** Benchmark GPU tracing, film readback, and time to first visible image separately at 128 × 128 and 256 × 256. Compare randomized low-discrepancy sampling with the current pseudorandom sampler against a high-SPP reference. Measure intensity, Q, U, and V separately and verify on a phone.
- [x] **Benchmarked half precision for Mueller transport on the M5.** Scratch shaders stored the per-path Mueller matrices in `f16` and tested matrix products in both `f32` and `f16`. With the default RGB Cornell box at 256 SPP, the full `f32` shader took 33.7 ms at 128 × 128 and 119.8 ms at 256 × 256. The `f16` products took 32.4 ms and 120.3 ms, respectively. Timings are medians of nine headless WebGPU runs including film readback. Keep `f32` in production. A phone benchmark remains part of the renderer performance work.
- [ ] **Reduce work per GPU estimate.** Keep the progressive display on the GPU and measure the effect of delaying full-film readback until export. On the M5 reference Cornell box at 256 × 256 and 256 SPP, a scratch shader that skipped room-wall shadow tests inside the box took 106.2 ms versus 111.9 ms for the current shader and produced identical output. Sharing geometric calculations across RGB took 108.9 ms.
- [x] **Orbit the scene camera like Pollia.** Drag the viewport to orbit the Cornell box and render the new camera angle on release. Arrow keys also orbit the camera. Keep camera distance as the only slider and use the default camera position for browser PNG exports.
- [x] **Live camera preview while dragging.** Render one sample per pixel at reduced resolution during the drag. Use the selected resolution and sample count on release. Keep the temporary previews out of the film and exports.
- [x] **Live light updates.** While a light slider (degree of polarization, angle of polarization, ellipticity) moves, show one-sample, reduced-resolution previews like camera orbiting, then start a full fresh render on release. Switching between Unpolarized and Polarized renders immediately. Re-render remains for other scene settings.
- [ ] **Desktop and phone support.** Verify that users can open, edit, and render a scene on both desktop and phone browsers. Tune preview quality so the controls stay responsive during rendering.

- [ ] **Polarization learning tool.** Grow Pocket Pol into a tool for learning polarization, not just a renderer, building on the interactive light and analyzer controls.

## Future scene and material tools

- [ ] **Bring your own 3D model.** Let users load a 3D file from their device, place it in the scene, and render it under a light source. Supported formats and import settings are open decisions.
- [ ] **PBR and polarized ray tracing (PRT).** Let users render the same model and lighting in either mode so they can compare an ordinary physically based image with a polarization-aware render.
- [ ] **Quick glass and isotropic crystal presets.** Make it easy to render a glass statue or a simple isotropic crystal for fun. Use Schlick’s approximation for angle-dependent Fresnel reflectance in the quick PBR preset. Use polarization-aware Fresnel transport for a polarized dielectric preset.

- [ ] **D’Alembert statue scene.** Add a built-in scene featuring a statue of d’Alembert.

The initial browser version follows the features in Pollia's window.

Defer Jones transport. Use Stokes vectors and Mueller matrices for path accumulation in both the browser and headless renderer.

## Naming ideas

- **Pocket Pol** (`pocket-pol`) is the chosen name, short for **Pocket Polarization**. Web Pol was an earlier candidate.

## GitHub and hosting

- [x] Connect `pocket-pol.abhimangupta.com` to the existing preview site over HTTPS.
- [x] Move the browser deployment from ChatGPT Sites to public GitHub Pages. Verify WebGPU and HTTPS on `pocket-pol.abhimangupta.com` before retiring the old hosting. (2026-11-20: the `web/` build is live on `gh-pages`, GitHub issued the custom-domain certificate (expires 2027-02-18), and the HTTPS site gets a WebGPU adapter. Enforce HTTPS is on, so HTTP redirects to HTTPS.)
- [x] Build the Pollia-style browser version on `test-pocket-pol-web`. Use native Pollia to compare the browser renderer's output.
- [x] **Full credits.** Credit Mitsuba 3 and its contributors, Pollia, PolRay, and the Jarecki model research in the app and source documentation. The credits page explains that Pollia is built as a fork of Mitsuba 3, lists what Pocket Pol adapts from Pollia and PolRay, cites the Jarecki and Kupinski paper with its DOI, credits the DM Sans and DM Mono fonts (OFL 1.1), reproduces the BSD 3-Clause notice, and states that Pocket Pol is not affiliated with or endorsed by EPFL or the Mitsuba 3 developers.
- [x] **Pocket Pol license.** Pocket Pol is released under the BSD 3-Clause License, © 2026 Abhiman Gupta (root `LICENSE`). `web/LICENSE` ships with the site and adds Mitsuba's original notice for the portions adapted from Pollia and Mitsuba 3. Ship the upstream license and preferred Mitsuba 3 citation with the browser build.
- Credit Charlie Tribble, Abhiman Gupta, and Matthew Kupinski by name (no GitHub handles) as Pollia’s developers.

- [x] **Automatic deploys with GitHub Actions.** Every push to `main` that touches `web/` publishes the site through `.github/workflows/deploy.yml`, so the live site always matches committed source. Pages uses the GitHub Actions source with the custom domain and Enforce HTTPS kept in settings.

## Design preferences

- [x] **Polish the browser styling.** (Title superseded by the minimal title entry above.) Group the settings and render action in one inspector and use a restrained neutral palette so the render remains the focus.

- [x] **Refresh the browser workspace.** Give the Cornell box the largest surface, put the light inspector on the right on desktop and below the image on mobile, and keep status and exports at the edge of the viewport. Size the viewer to the square image, place its controls directly on the workspace, and inset the colorbar within the render frame. Use a bold Pocket Polarization title directly on the page and put Credits and licenses in the page footer.

- [x] **Dedicated Light Source section first.** The control panel opens with a Light Source card above Filter. Its dropdown offers Unpolarized or Polarized, and choosing Polarized reveals degree of polarization, angle of polarization, and ellipticity, starting at 100% DoP. The light intensity slider has been removed for now; renders use the default intensity. On phones the colorbar sits horizontally under the image so the render stays full width.

- [x] **Analyzer angle slider.** In the Filter section, the Analyzer and RGB Analyzer views show an Analyzer angle slider from 0° to 180° in 1° steps, styled like the light source sliders, and the image updates live as it moves. It replaced the PolRay-style analyzer wheel to save space. The analyzer is linear only; the 0°/45°/90°/135°/RCP/LCP preset buttons were removed earlier.

- [x] **Creator credit under the subtitle.** Below “No downloads. No command line.”, show “Created by Abhiman Gupta” with the underlined name linking to the abhimangupta.com homepage.

- [x] **Light slider labels on one line.** Degree of polarization, angle of polarization, and ellipticity labels and values are one point smaller, and the Light Source card is wider than Filter beside it, so each label and value fit on one line on desktop even at 100% DoP or −90.0°. Phones still wrap the two long labels.

- [ ] **Phone layout for Light Source and Filter.** On phones the Filter card sits beside the taller Light Source column. Filter no longer stretches to match its height, which removes the empty space inside the card with RGB Intensity, but the column next to Light Source is still empty. Revisit the arrangement for readability.

- [x] **Match abhimangupta.com.** Use the site's warm paper palette (#ecebe6, #f8f7f3, ink #121211, lines #cfcdc6), DM Mono for display text and DM Sans for body text, square corners, 1px rules, no shadows, and small uppercase tracked labels. Light theme only, like the site. Title is “Pocket Pol”, centered, with the subtitle centered beneath.

- [ ] **Confirm fast rendering on a real iPhone.** iOS 26+ Safari ships WebGPU. In the iPhone 18 Pro simulator (iOS 27.2), Safari exposes `navigator.gpu` in both the page and the worker, but `requestAdapter()` returns no adapter in either, so the simulator always uses the CPU renderer (about 0.3 s per sample at 256 × 256). Open the site with `?stats` on a physical iPhone; the GPU note row explains any fallback.

- [x] **Minimal title and figure-style viewer.** Show a bold, minimal title (now “Pocket Pol”, see above) with “A physically based polarization renderer on the web” on its own line beneath. Remove the Cornell Box heading, the size and channel label, and the filter pill on the image. Place the colorbar outside the image on its right, with ticks, values, and a vertical label like a figure legend. Say only “Drag to orbit” under the image, report progress in samples per pixel, and replace Save PNG with Reset camera. Put Filter first in the control panel, then Render, then the Scene, Display, and Camera tabs. Pocket Pol is a standalone web app dedicated to polarization rendering, with Pollia as the reference for its models, and it should work well on phones.

- [x] **Major UI pass and bug sweep.** Split the sidebar into Scene/Display/Camera, Filter, and Render cards with Live and Fresh estimate tags. Use segmented controls for channels and image size, toggle switches, sample presets (8, 64, 256, 1024; now 64, 256, 1024), and sliders that fill from zero. Overlay the active view and a progress bar on the render, show a spinner before the first frame, and report progress as completed / requested SPP with a status dot. Keep scene edits available during a render and flag them on the Fresh estimate button. Explain invalid sample counts and why Save PNG re-renders from the default camera, and name PNGs after the active view. Follow the system light or dark theme. On phones, place Render and Filter directly under the image.

- [x] **Re-render bar under the image.** Keep only the progress bar at the image's bottom edge. Remove the status text (Ready, samples per pixel, Camera preview) below the image while keeping it for screen readers. Put Re-render on the left, Drag to orbit centered, and Reset camera on the right. Re-render turns solid with an amber dot when settings such as light intensity change, and applies them. Remove the Fresh estimate tags from Light Source and Scene setup, and say Fresh render instead of Fresh estimate everywhere.

- [x] **Light Source and Filter side by side.** Place the two cards next to each other on desktop and phone so users can adjust the source and the filter together. Drop the visible Polarization label beside the Unpolarized/Polarized dropdown. Filter keeps its Live tag. Widen the desktop sidebar so both cards fit.

- [x] **Colorbar space only when needed on phones.** On phones, collapse the space under the image when the active filter has no colorbar, such as RGB Intensity, so the Re-render bar sits right under the render.

- [x] **Tagline.** Subtitle, README, and GitHub description read “A physically based polarization renderer that runs entirely in your browser. No downloads. No command line.” “No command line” describes the site visitor's experience; the headless renderer is a developer tool.

- [x] **Viewer bar aligned to the image.** On wider screens, Re-render sits flush with the image's left edge, Reset camera with its right edge, and Drag to orbit is centered under the image, whether or not the colorbar is shown. The hidden colorbar column used to push Reset camera past the image (reported in Safari).

- Use neutral graphite and silver for the controls and interface accents, leaving saturated color to the rendered scene and material swatches.
- Make the render the focal point. Pair the render with a light, tabbed inspector for Scene, Display, and Camera. Keep render actions together and exports beside the viewport.
- Put the polarization view selector, its explanations, and the analyzer angle in a dedicated Filter section in the control panel. Omit the explanatory sentence for RGB Intensity. Make source polarization easy to find, and distinguish live display adjustments from scene edits that need a fresh estimate.
