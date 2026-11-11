const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const players = new Map();
const blocks = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(data, except) {
  const raw = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(raw);
  }
}
function cleanName(v) {
  return String(v || "Player").replace(/[<>]/g, "").trim().slice(0, 16) || "Player";
}
wss.on("connection", ws => {
  const id = Math.random().toString(36).slice(2, 10);
  const player = { id, name: "Player", x: 0, y: 8, z: 0, yaw: 0, color: Math.floor(Math.random()*0xffffff) };
  players.set(id, player);

  send(ws, { type: "welcome", id, players: [...players.values()], blocks: [...blocks.entries()].map(([key, type]) => {
    const [x,y,z] = key.split(",").map(Number); return {x,y,z,block:type};
  }) });
  broadcast({ type: "player-joined", player }, ws);

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "hello") {
      player.name = cleanName(msg.name);
      broadcast({ type: "player-name", id, name: player.name }, ws);
    }
    if (msg.type === "move") {
      const vals = [msg.x, msg.y, msg.z, msg.yaw];
      if (!vals.every(Number.isFinite)) return;
      if (Math.abs(msg.x) > 10000 || Math.abs(msg.z) > 10000) return;
      player.x = msg.x; player.y = msg.y; player.z = msg.z; player.yaw = msg.yaw;
      broadcast({ type: "player-moved", player }, ws);
    }
    if (msg.type === "block") {
      const {x,y,z,block} = msg;
      if (![x,y,z].every(Number.isInteger) || Math.abs(x)>256 || Math.abs(z)>256 || y<0 || y>128) return;
      const key = `${x},${y},${z}`;
      if (block === null) blocks.delete(key);
      else if (["grass","dirt","stone","wood","leaves","sand","planks"].includes(block)) blocks.set(key, block);
      else return;
      broadcast({ type: "block", x,y,z,block: block === null ? null : block }, ws);
    }
    if (msg.type === "chat") {
      const text = String(msg.text || "").replace(/[<>]/g, "").trim().slice(0,120);
      if (text) broadcast({ type: "chat", id, name: player.name, text });
    }
  });

  ws.on("close", () => {
    players.delete(id);
    broadcast({ type: "player-left", id });
  });
});
server.listen(PORT, () => console.log(`BlockWorld Online running at http://localhost:${PORT}`));
