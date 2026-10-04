# Static deployment

Coolify uses Railpack, `pnpm run build`, and the `/dist` publish directory
with **Is it a static site?** enabled.

The build writes `.gz` and `.br` copies beside HTML, CSS, and JavaScript files.
The original files remain available for clients that do not accept compression.

`nginx.conf` is the configuration saved in Coolify under
**Configuration > General > Nginx Configuration**. Changes to this file must
also be saved in Coolify and deployed; Coolify does not load it from the
repository automatically.

The standard `nginx:alpine` image serves the precompressed gzip files using
`gzip_static`. Cloudflare can deliver Brotli to visitors. The generated `.br`
files are available for a future origin image with the Brotli static module;
do not enable `brotli_static` on an image without that module.
