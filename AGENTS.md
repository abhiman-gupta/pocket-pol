# Pocket Pol project instructions

Whenever the user shares a new Pocket Pol idea, feature, or direction in a prompt, capture it in `IDEAS.md` while handling the request. Update a related entry when the user refines it. Mark features complete once they are implemented and verified.

Develop Pocket Pol (`abhiman-gupta/pocket-pol`) on `main`.

Deployment is automatic: pushing changes under `web/` to `main` runs `.github/workflows/deploy.yml`, which publishes `web/` to GitHub Pages (excluding the Node-only `render.mjs`, `headless.mjs`, and `README.md`). To deploy, commit and push to `main`, then confirm the "Deploy site" run succeeds. The custom domain `pocket-pol.abhimangupta.com` and Enforce HTTPS live in the repository's Pages settings, so no `CNAME` file is needed. The old `gh-pages` branch is no longer used.
