const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const express = require("express");
const rateLimit = require("express-rate-limit");

test("el proxy separa los limites por IP y no confia en la IP falsificada a la izquierda", async () => {
  const app = express();
  app.listen = () => {};
  const errores = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../server.js"), "utf8"), {
    process: { env: {} },
    console: { log() {}, error: (...args) => errores.push(args) },
    require(nombre) {
      if (nombre === "express") return Object.assign(() => app, express);
      if (nombre === "express-rate-limit") {
        return (opciones) => {
          assert.equal(app.get("trust proxy"), 1);
          return rateLimit({ ...opciones, limit: 2 });
        };
      }
      if (nombre === "dotenv") return { config() {} };
      if (nombre === "./config/db") return {};
      if (nombre.startsWith("./routes/")) return express.Router();
      if (nombre === "./middlewares/authMiddleware") {
        return { verificarAutenticacion: (_req, _res, next) => next() };
      }
      if (nombre === "./middlewares/suscripcionMiddleware") {
        return { verificarSuscripcionActiva: (_req, _res, next) => next() };
      }
      return require(nombre);
    },
  });
  // El servidor real termina en 404 para esta ruta; el limiter devuelve 429 al agotarse.
  const servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${servidor.address().port}/api/proxy-test`;
    const pedir = async (ip) => {
      const respuesta = await fetch(url, { headers: { "X-Forwarded-For": ip } });
      await respuesta.text();
      return respuesta.status;
    };
    assert.equal(await pedir("198.51.100.10"), 404);
    assert.equal(await pedir("198.51.100.10"), 404);
    assert.equal(await pedir("198.51.100.10"), 429);
    assert.equal(await pedir("198.51.100.20"), 404);
    assert.equal(await pedir("203.0.113.99, 198.51.100.10"), 429);
    assert.deepEqual(errores, []);
  } finally {
    await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
  }
});
