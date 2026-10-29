
import { createServer } from "node:http";
import handler from "./api/index.js";

const server = createServer(async (req, res) => {
  try {
    let rawBody = "";

    for await (const chunk of req) {
      rawBody += chunk;
      if (rawBody.length > 1_000_000) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request too large" }));
        return;
      }
    }

    let body = {};

    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
    }

    const response = {
      statusCode: 200,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      json(data) {
        if (res.writableEnded) return;
        res.writeHead(this.statusCode, {
          "Content-Type": "application/json; charset=utf-8",
          ...this.headers
        });
        res.end(JSON.stringify(data));
      }
    };

    await handler(
      {
        method: req.method,
        headers: req.headers,
        body
      },
      response
    );

    if (!res.writableEnded) {
      response.status(500).json({ error: "No response from handler" });
    }
  } catch (error) {
    console.error("Server error:", error?.message || error);

    if (!res.writableEnded) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

const port = Number(process.env.PORT || 3000);

server.listen(port, "0.0.0.0", () => {
  console.log(`GenStation API listening on port ${port}`);
});
