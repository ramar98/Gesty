const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function cargar(nombre, dependencias = {}, env = {}, extra = {}) {
  const modulo = { exports: {} };
  const contexto = {
    module: modulo, exports: modulo.exports, Buffer, URL, AbortSignal, console,
    process: { env }, ...extra,
    require: (nombre) => {
      if (nombre in dependencias) return dependencias[nombre];
      if (nombre === "crypto") return crypto;
      throw new Error(`Dependencia sin simular: ${nombre}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", nombre), "utf8"), contexto);
  return modulo.exports;
}

function registroFixture({ estado = "PENDIENTE", codigoId = null, fallarEmpresa = false } = {}) {
  const registro = { id: 1, estado, monto: 10000, meses: 1, codigo_id: codigoId, empresa_id: null,
    datos: { empresa: { nombre: "Prueba", plan: "BASICO" }, administrador: { passwordHash: "hash" } } };
  let cola = Promise.resolve();
  let creaciones = 0;
  let consumos = 0;
  let rollbacks = 0;
  const db = {
    getConnection: async () => {
      let desbloquear;
      let snapshot;
      return {
        beginTransaction: async () => {
          const anterior = cola;
          cola = new Promise((resolve) => { desbloquear = resolve; });
          await anterior;
          snapshot = { ...registro };
        },
        query: async (sql, args) => {
          if (sql.startsWith("SELECT")) return [[{ ...registro }]];
          if (sql.includes("SET estado")) registro.estado = args[0];
          if (sql.includes("SET empresa_id")) registro.empresa_id = args[0];
          return [{ affectedRows: 1 }];
        },
        commit: async () => {},
        rollback: async () => { Object.assign(registro, snapshot); rollbacks++; },
        release: () => desbloquear(),
      };
    },
  };
  const service = cargar("services/registroService.js", {
    "../config/db": db, bcryptjs: {}, "./pagosService": {}, "./suscripcionesService": {},
    "./codigosService": { consumirCodigo: async (_id, connection) => { assert.ok(connection); consumos++; } },
    "./empresasService": { crearEmpresa: async (_datos, connection) => {
      assert.ok(connection); if (fallarEmpresa) throw new Error("Falló la creación");
      creaciones++; return { empresa: { id: 12 } };
    } },
  });
  return { service, registro, contadores: () => ({ creaciones, consumos, rollbacks }) };
}

test("registro: un monto incorrecto nunca queda aprobado ni crea la empresa", async () => {
  const f = registroFixture();
  await assert.rejects(f.service.confirmarRegistro("REG-TEST", "123", "approved", 1), { code: "MONTO_INVALIDO" });
  assert.equal(f.registro.estado, "PENDIENTE");
  assert.equal(f.contadores().creaciones, 0);
  assert.equal(f.contadores().rollbacks, 1);
});

test("registro: rechaza un importe ausente o no numérico", async () => {
  for (const monto of [undefined, null, NaN, Infinity]) {
    const f = registroFixture();
    await assert.rejects(f.service.confirmarRegistro("REG-TEST", "123", "approved", monto), { code: "MONTO_INVALIDO" });
    assert.equal(f.registro.estado, "PENDIENTE");
  }
});

test("registro: una diferencia de un centavo impide la acreditación", async () => {
  const f = registroFixture();
  await assert.rejects(f.service.confirmarRegistro("REG-TEST", "123", "approved", 9999.99), { code: "MONTO_INVALIDO" });
  assert.equal(f.registro.estado, "PENDIENTE");
});

test("registro: webhook y verificación concurrentes crean una sola empresa y consumen un solo código", async () => {
  const f = registroFixture({ codigoId: 4 });
  const resultados = await Promise.all([
    f.service.confirmarRegistro("REG-TEST", "123", "approved", 10000),
    f.service.confirmarRegistro("REG-TEST", "123", "approved", 10000),
  ]);
  assert.ok(resultados.every((r) => r.creada));
  assert.equal(f.contadores().creaciones, 1);
  assert.equal(f.contadores().consumos, 1);
  assert.equal(f.registro.empresa_id, 12);
});

test("registro: una falla al crear empresa revierte la acreditación", async () => {
  const f = registroFixture({ fallarEmpresa: true });
  await assert.rejects(f.service.confirmarRegistro("REG-TEST", "123", "approved", 10000));
  assert.equal(f.registro.estado, "PENDIENTE");
  assert.equal(f.registro.empresa_id, null);
});

test("registro: recupera una aprobación posterior al rechazo", async () => {
  const f = registroFixture({ estado: "RECHAZADO" });
  const resultado = await f.service.confirmarRegistro("REG-TEST", "456", "approved", 10000);
  assert.equal(resultado.creada, true);
  assert.equal(f.registro.estado, "APROBADO");
});

test("registro: recupera altas antiguas aprobadas sin empresa", async () => {
  const f = registroFixture({ estado: "APROBADO" });
  const resultado = await f.service.confirmarRegistro("REG-TEST");
  assert.equal(resultado.creada, true);
  assert.equal(f.contadores().creaciones, 1);
});

function pagosFixture({ query, connection, payment = {}, fetch } = {}, env = {}) {
  return cargar("services/pagosService.js", {
    "../config/db": { query, getConnection: async () => connection },
    "./suscripcionesService": { PRECIO_MENSUAL: 10000, extender: async () => {} },
    "./codigosService": { validarCodigo: async () => ({ id: 1, tipo: "DESCUENTO", descuento_porcentaje: 100 }), consumirCodigo: async () => {} },
    mercadopago: { MercadoPagoConfig: class {}, Payment: class { search = payment.search; get = payment.get; } },
    qrcode: { toDataURL: async () => "data:image/png;base64,qr" },
  }, env, { fetch });
}

test("webhook: una firma mal formada devuelve rechazo sin excepciones", async () => {
  const service = pagosFixture({}, { MP_WEBHOOK_SECRET: "secreto" });
  await assert.rejects(service.procesarWebhook({ headers: { "x-signature": "ts=123,v1=x", "x-request-id": "request" }, query: { "data.id": "12" } }), { code: "FIRMA_INVALIDA" });
});

test("webhook: acepta firma válida con ID en body y hex en mayúsculas", async () => {
  const secreto = "secreto";
  const signature = crypto.createHmac("sha256", secreto).update("id:12;request-id:request;ts:123;").digest("hex").toUpperCase();
  const service = pagosFixture({}, { MP_WEBHOOK_SECRET: secreto });
  const resultado = await service.procesarWebhook({ headers: { "x-signature": `ts=123,v1=${signature}`, "x-request-id": "request" }, query: {}, body: { type: "otro", data: { id: "12" } } });
  assert.equal(resultado.procesado, false);
});

test("webhook: producción exige secreto", async () => {
  const service = pagosFixture({}, { NODE_ENV: "production" });
  await assert.rejects(service.procesarWebhook({ headers: {}, query: {} }), { code: "FIRMA_INVALIDA" });
});

test("QR: usa POST independiente y devuelve vencimiento", async () => {
  let request;
  const service = pagosFixture({ fetch: async (_url, opciones) => { request = opciones; return { ok: true, json: async () => ({ qr_data: "qr", in_store_order_id: "orden" }) }; } }, { MP_ACCESS_TOKEN: "fake", MP_COLLECTOR_ID: "1", MP_POS_EXTERNAL_ID: "caja" });
  const resultado = await service.crearOrdenQr({ referencia: "123", titulo: "Test", monto: 10000 });
  assert.equal(request.method, "POST");
  assert.ok(request.signal);
  assert.ok(new Date(resultado.expira_en) > new Date());
  assert.equal(JSON.parse(request.body).total_amount, 10000);
});

test("verificación: consulta el pago concreto y exige pertenencia a la empresa", async () => {
  let parametros;
  const service = pagosFixture({ query: async (_sql, args) => { parametros = args; return [[]]; } });
  await assert.rejects(service.verificarPagoPendiente(10, 20), { code: "PAGO_NO_ENCONTRADO" });
  assert.equal(parametros[0], 10);
  assert.equal(parametros[1], 20);
});

test("verificación: informa aprobado aunque el webhook ya lo haya procesado", async () => {
  const service = pagosFixture({ query: async () => [[{ id: 20, estado: "APROBADO" }]] });
  const resultado = await service.verificarPagoPendiente(10, 20);
  assert.equal(resultado.estado, "APROBADO");
  assert.equal(resultado.pendiente, false);
});

test("verificación: descarta importes aprobados en otra moneda", async () => {
  const service = pagosFixture({ payment: { search: async () => ({ results: [{ id: 1, status: "approved", currency_id: "USD", external_reference: "20" }] }) } }, { MP_ACCESS_TOKEN: "fake" });
  await assert.rejects(service.buscarPagoPorReferencia("20"), { code: "PAGO_INVALIDO" });
});

test("renovación: descuento del 100% acredita sin llamar a Mercado Pago", async () => {
  let acreditado = false;
  const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => sql.includes("UPDATE pagos_suscripcion") ? (acreditado = true, [{ affectedRows: 1 }]) : [[{ empresa_id: 1, meses: 1, monto: 0, codigo_id: 1 }]] };
  const service = pagosFixture({ query: async () => [{ insertId: 1 }], connection, fetch: async () => { throw new Error("No debe consultar MP"); } });
  const resultado = await service.crearPago(1, { codigo: "GRATIS", meses: 1 });
  assert.equal(resultado.gratis, true);
  assert.equal(resultado.monto, 0);
  assert.equal(acreditado, true);
});
