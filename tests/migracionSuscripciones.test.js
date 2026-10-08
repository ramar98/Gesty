const { test } = require("node:test");
const assert = require("node:assert/strict");
const { crearPlan, obtenerDefiniciones } = require("../scripts/migrarSuscripciones");

function metadatos({ vencimiento = true, excluir = [], columnaFaltante } = {}) {
  const columnas = [{ tabla: "empresas", columna: "id", tipo: "int" }, { tabla: "roles", columna: "id", tipo: "int" }, { tabla: "roles", columna: "nombre", tipo: "varchar" }];
  if (vencimiento) columnas.push({ tabla: "empresas", columna: "suscripcion_vence", tipo: "datetime" });
  for (const definicion of obtenerDefiniciones()) {
    if (excluir.includes(definicion.tabla)) continue;
    for (const columna of definicion.columnas) {
      if (`${definicion.tabla}.${columna}` !== columnaFaltante) columnas.push({ tabla: definicion.tabla, columna, tipo: "int" });
    }
  }
  return columnas;
}

function conexion(columnas, rol = true) {
  return { query: async (sql) => {
    assert.match(sql, /^\s*SELECT /, "La inspección no puede ejecutar escrituras");
    return sql.includes("information_schema.COLUMNS") ? [columnas] : [rol ? [{ id: 3 }] : []];
  } };
}

test("migración: una base actualizada no tiene pasos pendientes", async () => {
  assert.deepEqual(await crearPlan(conexion(metadatos())), []);
});

test("migración: sobre suscripciones anteriores agrega solo pagos_registro", async () => {
  const plan = await crearPlan(conexion(metadatos({ excluir: ["pagos_registro"] })));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].descripcion, "Crear pagos_registro");
  assert.match(plan[0].sql, /^CREATE TABLE pagos_registro/);
});

test("migración: el plan inicial es aditivo y no borra ni reemplaza datos", async () => {
  const plan = await crearPlan(conexion(metadatos({ vencimiento: false, excluir: obtenerDefiniciones().map((d) => d.tabla) }), false));
  assert.equal(plan.length, 5);
  assert.match(plan[0].sql, /^ALTER TABLE empresas ADD COLUMN/);
  assert.equal(plan.filter((paso) => paso.sql.startsWith("CREATE TABLE")).length, 3);
  assert.match(plan[4].sql, /WHERE NOT EXISTS/);
  for (const paso of plan) assert.doesNotMatch(paso.sql, /\b(DROP|DELETE|TRUNCATE|REPLACE)\b/i);
});

test("migración: una tabla existente incompleta requiere revisión", async () => {
  await assert.rejects(crearPlan(conexion(metadatos({ columnaFaltante: "pagos_suscripcion.mp_payment_id" }))), /faltan columnas: mp_payment_id/);
});

test("migración: detiene la operación si falta el esquema base", async () => {
  await assert.rejects(crearPlan(conexion([])), /Falta el esquema base de empresas/);
});
