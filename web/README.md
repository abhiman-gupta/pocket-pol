# Pocket Pol

Pocket Polarization is a lightweight version of the Mitsuba 3 renderer for desktop and phone browsers, with custom polarized bidirectional reflectance distribution function (pBRDF) models.

## First milestone

Produce a square Cornell box render in a browser from a small, pinned subset of upstream Mitsuba 3. Start with built-in geometry, one area light, and diffuse materials. Use a native `scalar_rgb` render of the same scene as the comparison. Keep browser build changes under `web/` where practical and document any upstream changes needed for compilation.

- Use PolRay’s open-front Cornell box geometry and camera as the scene reference.
- Test a CPU WebAssembly build in a worker and measure download size, time to first image, and responsiveness on a desktop and a phone.
- Offer 128 × 128 and 256 × 256 renders, with 256 × 256 selected by default.

## After the first render

- Add polarized transport and a custom pBRDF, with reference checks against native polarized Mitsuba output. Give each material model defined parameters and an explicit validation step.
- Add built-in sample statues and local model import inside the same room. Choose the first supported mesh format and set resource limits after testing on phones.
- Compare a WebGPU backend once the CPU reference path provides a way to check image and polarization results.
