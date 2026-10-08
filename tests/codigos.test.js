const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mysql = require("mysql2");

function servicio(query) {
  const modulo = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/codigosService.js"), "utf8"), {
    module: modulo,
    require: (nombre) => nombre === "crypto" ? crypto : { query },
  });
  return modulo.exports;
}

const codigo = { tipo: "DESCUENTO", descuento_porcentaje: 10, usos_maximos: 1 };

test("código con vencimiento ISO envía Date a MySQL y conserva el instante elegido", async () => {
  const iso = new Date(Date.now() + 86400000).toISOString();
  let parametros;
  const service = servicio(async (_sql, args) => { parametros = args; return [{ insertId: 1 }]; });
  const resultado = await service.crearCodigo({ ...codigo, expira_en: iso });
  assert.equal(resultado.tipo, "DESCUENTO");
  assert.equal(Object.prototype.toString.call(parametros[5]), "[object Date]");
  assert.equal(parametros[5].toISOString(), iso);
  assert.match(mysql.escape(parametros[5]), /^'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}'$/);
});

test("código sin vencimiento guarda NULL", async () => {
  let parametros;
  const service = servicio(async (_sql, args) => { parametros = args; return [{ insertId: 1 }]; });
  await service.crearCodigo({ ...codigo, expira_en: null });
  assert.equal(parametros[5], null);
});

test("fechas inválidas o vencidas fallan antes de consultar MySQL", async () => {
  const service = servicio(async () => { assert.fail("No debe ejecutar SQL con fecha inválida"); });
  for (const fecha of ["fecha inválida", "2020-01-01T00:00:00.000Z"]) {
    await assert.rejects(service.crearCodigo({ ...codigo, expira_en: fecha }), { code: "FECHA_INVALIDA" });
  }
});
