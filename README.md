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
