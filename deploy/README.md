# Static deployment

Coolify uses the repository's `Dockerfile` build pack and exposes port 80.
The build stage installs locked dependencies with pnpm 10, then runs
`pnpm run build`. The final image uses the official Caddy image to serve `dist`.
Coolify continues to build and deploy automatically when the repository changes.

The build writes gzip level 9 and Brotli level 11 copies beside HTML, CSS, and
JavaScript files.
The original files remain available for clients that do not accept compression.

`Caddyfile` is copied into the image on every build. Caddy's static file server
prefers the prebuilt `.br` file, falls back to `.gz`, and serves the original
when neither encoding is accepted. Compression runs at build time only.
Coolify's existing proxy handles public HTTPS; Caddy listens on internal port 80.

Responses include `Cache-Control: no-transform` so Cloudflare preserves the
origin's compression. Keep features that modify response bodies disabled,
including Rocket Loader, automatic HTTPS rewrites, email obfuscation, Cloudflare
Fonts, and injected analytics. Purge old cached responses after changing the
compression policy, or use new asset URLs.

The `_astro-br` asset directory bypasses Cloudflare's previously cached,
recompressed `_astro` URLs during this migration.

To verify end-to-end compression, request a normal page/asset with
`Accept-Encoding: br` and compare its raw response bytes with the corresponding
`.br` file in the build output. A `Content-Encoding: br` header alone does not
prove that a CDN preserved the precompressed bytes.
