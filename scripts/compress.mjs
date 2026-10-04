import { readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const extensions = new Set([".js", ".css", ".html"]);
let count = 0;
let originalBytes = 0;
let gzipBytes = 0;
let brotliBytes = 0;

async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      await compress(path);
    } else if (entry.isFile() && extensions.has(extname(path))) {
      const content = await readFile(path);
      const { atime, mtime } = await stat(path);
      const gzip = gzipSync(content, { level: 9 });
      const brotli = brotliCompressSync(content, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        },
      });

      for (const [suffix, compressed] of [
        ["gz", gzip],
        ["br", brotli],
      ]) {
        const output = `${path}.${suffix}`;
        await writeFile(output, compressed);
        await utimes(output, atime, mtime);
      }

      count += 1;
      originalBytes += content.length;
      gzipBytes += gzip.length;
      brotliBytes += brotli.length;
    }
  }
}

await compress(fileURLToPath(new URL("../dist/", import.meta.url)));

console.log(
  `Compressed ${count} files: ${originalBytes} bytes original, ${gzipBytes} bytes gzip, ${brotliBytes} bytes Brotli.`,
);
