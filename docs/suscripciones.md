# Suscripciones y altas con Mercado Pago

## Comportamiento

- El alta acepta el plan `BASICO`. `GET /api/empresas/planes` informa el precio mensual configurado para mostrarlo antes del registro.
- La empresa, el administrador, la configuración, la acreditación y el consumo del código se guardan en una misma transacción. El bloqueo de la fila de registro evita altas duplicadas por webhook y verificación simultáneos.
- Se valida el importe en centavos antes de aprobar. Los pagos consultados en Mercado Pago deben corresponder a ARS y al cobrador configurado.
- Los códigos que cubren el 100% se acreditan sin generar un QR, tanto en registro como en renovación.
- El QR se genera con `POST /instore/orders/qr/seller/collectors/{collector}/pos/{pos}/qrs`, con vencimiento de 15 minutos. Cada orden es independiente; `PUT` vincula/reemplaza la orden de la caja y no corresponde a pantallas simultáneas de distintos clientes.
- `POST /api/suscripcion/verificar` acepta `{ "pago_id": 123 }`. Solo consulta pagos de la empresa autenticada y devuelve el estado aunque un webhook ya haya acreditado el pago. Sin `pago_id` conserva la búsqueda del último pendiente.
- Un intento rechazado puede recibir una aprobación posterior. Una aprobación ya aplicada nunca vuelve a extender la suscripción.
- En producción el webhook exige `MP_WEBHOOK_SECRET`. Las firmas mal formadas devuelven 401 sin provocar una excepción de comparación de buffers.
- El listado de empresas excluye el plan interno. Los códigos vencidos no cuentan como disponibles en los indicadores.

## Configuración

Completar las variables de `.env.example`: credenciales y caja de Mercado Pago, secreto del webhook, URL pública y precio mensual. El precio debe ser positivo. Las modificaciones usan las tablas de `database/migration_suscripciones.sql`; no agregan nuevas columnas.

La integración mantiene la API Dynamic QR existente; no migra a Orders API ni cambia los tópicos del webhook. Referencia oficial: [diferencias entre POST dinámico, PUT híbrido y Orders API](https://www.mercadopago.com.ar/developers/es/docs/qr-code/resources/migrate-dynamic-qr-model-to-orders).

## Validación

Ejecutar `npm test`. Las pruebas usan dobles de MySQL y Mercado Pago: no crean empresas reales ni cobran dinero. Cubren montos incorrectos/ausentes, concurrencia, rollback, recuperación de rechazos, firmas, QR independiente, pertenencia del pago y descuentos del 100%.

Para una prueba de integración, usar una base de pruebas y las cuentas de prueba de Mercado Pago. Comprobar alta pagada, renovación con vigencia, canje, descuento, webhook duplicado y verificación posterior al webhook. Las pruebas automatizadas locales no reemplazan la validación con MySQL y Mercado Pago reales.
