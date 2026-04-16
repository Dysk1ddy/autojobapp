import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const host = "127.0.0.1";
const port = 4174;
const rootDir = resolve(process.cwd(), "dist");
const sourceFixturesDir = resolve(process.cwd(), "src", "test", "fixtures");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const normalizedPath = normalize(decodeURIComponent(requestUrl.pathname)).replace(
    /^(\.\.[/\\])+/,
    ""
  );
  const shouldServeSourceFixture = normalizedPath.startsWith("/test-fixtures/");
  const relativePath =
    normalizedPath === "/" || normalizedPath === "\\" ? "/popup.html" : normalizedPath;
  let targetPath = shouldServeSourceFixture
    ? resolve(
        join(
          sourceFixturesDir,
          `.${relativePath.replace("/test-fixtures", "")}`
        )
      )
    : resolve(join(rootDir, `.${relativePath}`));

  const allowedRoot = shouldServeSourceFixture ? sourceFixturesDir : rootDir;

  if (!targetPath.startsWith(allowedRoot)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const targetStat = await stat(targetPath);

    if (targetStat.isDirectory()) {
      const fallbackFile =
        targetPath === rootDir ? join(targetPath, "popup.html") : join(targetPath, "index.html");
      targetPath = resolve(fallbackFile);
    }

    await access(targetPath);
    response.writeHead(200, {
      "Content-Type":
        MIME_TYPES[extname(targetPath)] ?? "application/octet-stream"
    });
    createReadStream(targetPath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`E2E server listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
