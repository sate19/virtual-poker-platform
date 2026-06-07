import http from "node:http";

const FRONTEND = "http://127.0.0.1:3001";
const BACKEND = "http://127.0.0.1:4000";

const PROXY_PORT = 3000;

function proxyRequest(req, res, targetBase) {
  const target = new URL(req.url, targetBase);
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };

  const proxyReq = http.request(options, (proxyRes) => {
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

  // Handle WebSocket upgrade
  req.on("upgrade", (msg) => {});

  proxyReq.on("upgrade", (proxyRes, socket, head) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    socket.write(head);
    socket.pipe(proxyReq.socket);
    proxyReq.socket.pipe(socket);
  });
}

function stripApiPrefix(url) {
  if (url.startsWith("/api/")) {
    return url.slice(4); // "/api/auth/login" → "/auth/login"
  }
  return url;
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/socket.io")) {
    req.url = stripApiPrefix(req.url);
    proxyRequest(req, res, BACKEND);
  } else {
    proxyRequest(req, res, FRONTEND);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/socket.io")) {
    const target = new URL(req.url, BACKEND);
    const options = {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    };
    const proxyReq = http.request(options);
    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        `HTTP/${req.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n` +
          Object.entries(proxyRes.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n") +
          "\r\n\r\n"
      );
      socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxyReq.write(head);
    proxyReq.end();
  } else {
    socket.destroy();
  }
});

server.listen(PROXY_PORT, () => {
  console.log(`Proxy: http://localhost:${PROXY_PORT}`);
});
