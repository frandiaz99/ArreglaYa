# ArreglaYa

Le sacás una foto a lo que se rompió y un chat con IA te dice qué pasa, qué tan urgente es y a qué profesional llamar: los mejores de tu zona, ordenados por cercanía, puntaje y disponibilidad.

> Prototipo / MVP. Los profesionales de la base son **ficticios** (`[DEMO] …`) y sirven solo para probar.

## Cómo probarlo

```bash
npm install
cp .env.example .env      # y completá ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
npm test                  # pruebas del ranking
```

Abrí `http://localhost:3000` en el celular o en la PC, subí una foto (o describí el problema) y vas a ver el diagnóstico y los 3 profesionales recomendados.

## Arquitectura

```
 Usuario ──foto/texto/ubicación──►  Canal  ──►  Asistente  ──►  Diagnóstico (Claude, visión)
                                  (web chat     (assistant.ts)    oficio · urgencia · seguridad · DIY
                                   o WhatsApp)        │
                                                      └──►  Ranking (ranking.ts)  ◄──  Base de profesionales (SQLite)
```

| Archivo | Qué hace |
|---|---|
| `src/diagnose.ts` | Manda la foto a Claude y recibe un diagnóstico **estructurado** (validado con Zod): oficio, urgencia, complejidad, advertencia de seguridad, si se puede resolver solo, y el mensaje para el usuario. |
| `src/guide.ts` | Modo **"Hacelo vos"**: guía paso a paso con herramientas, materiales (con link de búsqueda en Mercado Libre), cómo comprobar el arreglo y cuándo dejarlo y llamar a un profesional. |
| `src/claude.ts` | Cliente de Claude compartido: salida JSON validada, fallback ante rechazos, cache del prompt. |
| `src/ranking.ts` | Filtra y ordena profesionales. Lógica pura, cubierta por tests. |
| `src/db.ts` | SQLite (`node:sqlite`, sin dependencias nativas) con profesionales y reseñas + datos demo. |
| `src/assistant.ts` | Orquesta: diagnóstico → ¿falta ubicación? → ranking → respuesta. |
| `src/whatsapp.ts` | Webhook de WhatsApp Cloud API: recibe fotos/ubicación, valida la firma de Meta y responde. |
| `src/server.ts` | Express: `POST /api/chat` (web) y `/webhooks/whatsapp`. |
| `public/index.html` | Chat web mobile-first para probar sin WhatsApp. |

### Ranking

Para cada profesional del oficio correcto que cubre tu zona:

- **Calificación bayesiana**: `(4.2·10 + suma) / (10 + n)`. Un 5.0 con 2 reseñas no le gana a un 4.8 con 200.
- **Distancia** con decaimiento exponencial; en urgencias la escala es más corta (3 km) que en trabajos programados (12 km).
- **Tiempo de respuesta**, **tasa de trabajos completados** (con suavizado) y **disponible ahora**.
- **Los pesos cambian según la urgencia**: en una emergencia importa más que esté cerca y disponible; si no es urgente, pesa más la calificación.
- Bonus por identidad verificada; en emergencias, se penaliza a quien no ofrece servicio de urgencia.
- **Gasistas y electricistas sin matrícula quedan excluidos.**

### Seguridad del diagnóstico

El prompt obliga a dar primero la instrucción de seguridad si hay riesgo (cerrar la llave de paso, cortar la térmica, ventilar, llamar al 911 o a la emergencia de gas) y nunca sugiere que el usuario toque instalaciones de gas o tableros. No inventa precios: en Argentina cambian demasiado rápido y deben salir de datos reales de la plataforma.

### Modo "Hacelo vos"

Si el diagnóstico dice que el arreglo es seguro para alguien sin experiencia, el usuario elige entre **🔧 Hacelo vos** y **👷 Que venga alguien** (en WhatsApp: responder `GUIA` o mandar la ubicación). La guía tiene tres capas de seguridad:

1. El diagnóstico marca `diy_possible` solo si es seguro.
2. El servidor (`canOfferGuide`) **nunca** ofrece guía para gas ni para emergencias, diga lo que diga el modelo.
3. Al armar la guía, el modelo vuelve a evaluar (`safe_to_diy`) y, si no es seguro, deriva a profesionales.

Después de la guía siempre queda el botón "No pude, que venga alguien": el que intentó y no pudo es un cliente con alta intención.

**Monetización posible:** los links de materiales hoy son búsquedas comunes de Mercado Libre; se pueden convertir en links de afiliado una vez aprobado en su programa de afiliados.

## Modelo y costos

Por defecto **diagnóstico y guía usan Claude Haiku 5.5** (US$0,10 / US$0,50 por millón de tokens de entrada / salida): un diagnóstico típico cuesta menos de US$0,001. Se puede cambiar por ruta con `CLAUDE_MODEL_DIAGNOSIS` y `CLAUDE_MODEL_GUIDE` (por ejemplo, Opus 5.5 solo para la guía). Antes de decidir, conviene probar 20-30 fotos reales con cada modelo y comparar.

Haiku no tiene *fallback* del lado del servidor ante rechazos; Opus/Sonnet sí, y el código lo activa automáticamente para esos modelos.

## Seguridad: costos y prompt injection

| Protección | Dónde |
|---|---|
| **Límite de gasto en la consola de Anthropic** — el respaldo final, configurarlo siempre | console.anthropic.com → Limits |
| Presupuesto diario (`DAILY_BUDGET_USD`, por defecto US$5) calculado con el uso real de cada respuesta y guardado en SQLite | `budget.ts`, `pricing.ts` |
| Límite por IP / número de WhatsApp: 10 diagnósticos y 3 guías por hora (configurable) | `limits.ts` |
| Texto ≤ 500 caracteres, foto ≤ 5 MB, `max_tokens` 4096 (diagnóstico) / 8192 (guía) | `server.ts`, `diagnose.ts`, `guide.ts` |
| El diagnóstico queda en el servidor; la guía se pide por ID y se genera una sola vez | `assistant.ts` |
| WhatsApp: firma de Meta validada, mensajes duplicados descartados, sesiones que vencen a las 24 h, aviso de límite una sola vez | `whatsapp.ts` |
| Texto del usuario envuelto en `<mensaje_usuario>` y prompts que tratan texto e imagen como datos, no instrucciones | `claude.ts` |
| La IA nunca elige profesionales ni teléfonos: los agrega el código | `assistant.ts`, `ranking.ts` |

Si se publica la web: poner `TRUST_PROXY` si hay un proxy delante (para que el límite por IP use la IP real) y sumar un captcha invisible (Cloudflare Turnstile). Los límites y diagnósticos viven en memoria: con más de un servidor, moverlos a Redis.

## Conectar WhatsApp

1. Crear una app en Meta for Developers → producto WhatsApp → número de prueba.
2. Completar `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` y elegir un `WHATSAPP_VERIFY_TOKEN`.
3. Exponer el servidor con HTTPS (por ej. `cloudflared tunnel` o `ngrok`) y configurar el webhook en `https://<tu-dominio>/webhooks/whatsapp`, suscripto a `messages`.

Flujo: el usuario manda la foto → recibe el diagnóstico y se le pide la ubicación 📍 → la comparte → recibe 3 profesionales con teléfono.

## Competencia (Argentina, octubre 2026)

| App | Qué hace | Diferencia con ArreglaYa |
|---|---|---|
| Clickie | Marketplace con profesionales validados, ~40.000 usuarios | Sin diagnóstico por foto |
| Tegu (Córdoba) | Publicás una tarea y recibís ≥5 ofertas | Requiere describir el problema; foco Córdoba |
| Muovi (CABA) | Identidad verificada, reseñas e IA | El competidor más cercano: revisar a fondo |
| LaburAR, Aiiiuda, ProFessionals (Rosario) | Directorios / conexión directa | Sin IA ni ranking por urgencia |
| Picmend, YouFixedIt, HomieFix (EE.UU.) | Diagnóstico por foto + profesionales | No operan en Argentina |

**Posicionamiento propuesto:** "No sabés qué se rompió ni a quién llamar: mandá una foto por WhatsApp". La foto como punto de entrada, sin descargar una app nueva.

## Próximos pasos

1. **Curar la oferta a mano** en 1-2 barrios y 2 rubros (plomería + electricidad): verificar DNI y matrícula, cargar profesionales reales.
2. **Reseñas solo de trabajos reales**: después de cada contacto, preguntar por WhatsApp "¿te solucionaron el problema?" y pedir 1-5 estrellas.
3. **Métricas**: % de fotos con diagnóstico útil, % de contactos que terminan en trabajo, tiempo hasta la primera respuesta.
4. **Monetización** (validar después de tener uso): suscripción para profesionales, pago por contacto, o comisión con pago protegido + garantía (esto último también evita que se salteen la plataforma).
5. Persistir sesiones de WhatsApp (hoy en memoria), panel para profesionales, y estimación de precios con datos propios.
