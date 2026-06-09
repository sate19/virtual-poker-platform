import http from "node:http";
import { request as httpRequest } from "node:http";

const FRONTEND = "http://127.0.0.1:3001";
const BACKEND = "http://127.0.0.1:4000";
const PROXY_PORT = 3000;

function stripApiPrefix(url) {
  if (url.startsWith("/api/")) return url.slice(4);
  return url;
}

function proxyHTTP(req, res, targetBase, stripApi = false) {
  const url = stripApi ? stripApiPrefix(req.url) : req.url;
  const target = new URL(url, targetBase);
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };

  const proxyReq = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Bad Gateway");
    }
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    proxyHTTP(req, res, BACKEND, true);
  } else if (req.url.startsWith("/socket.io")) {
    proxyHTTP(req, res, BACKEND);
  } else {
    proxyHTTP(req, res, FRONTEND);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/socket.io")) {
    const target = new URL(req.url, BACKEND);
    const proxyReq = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      const headers = [
        `HTTP/${req.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}`,
        ...Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`),
        "\r\n",
      ].join("\r\n");
      socket.write(headers + proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on("error", () => socket.destroy());
    proxyReq.end();
  } else {
    socket.destroy();
  }
});

server.listen(PROXY_PORT, () => {
  console.log(`Proxy: http://localhost:${PROXY_PORT}`);
});
