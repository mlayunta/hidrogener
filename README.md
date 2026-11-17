# H₂ Verde · PWA de simulación termodinámica de hidrógeno renovable

**Autor: Miguel Ángel Layunta López**

Simulador de caja blanca para prefactibilidad de plantas de hidrógeno verde:
motor termodinámico y exergético, simulación horaria de 8 760 h, análisis
tecnoeconómico (LCOH nivelado, VAN, TIR), verificación RFNBO, benchmarking
frente a electrificación directa y generación de informes.

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | Aplicación completa (UI + motor de cálculo) |
| `sw.js` | Service Worker: modo offline |
| `manifest.webmanifest` | Manifiesto PWA (instalable) |
| `icon.svg` | Icono de la aplicación |
| `h2kernel.wasm` | *(opcional)* kernel acelerado en WebAssembly |

## Puesta en marcha

El modo offline, IndexedDB y la instalación **requieren servir por HTTP**
(no abrir con `file://`):

```bash
python -m http.server 8080
# o
npx serve .
```

Después abra `http://localhost:8080`. En Chrome/Edge aparecerá el botón
**Instalar app**. Para publicar, suba la carpeta a cualquier hosting estático
(GitHub Pages, Netlify, Cloudflare Pages).

## Perfiles horarios (resuelto: no hay que recargar el CSV)

1. En **1 · Datos → Perfil solar activo**, pulse **CSV** e importe el archivo.
2. El perfil se **valida, normaliza y guarda en IndexedDB** con su nombre.
3. Queda disponible en el desplegable y **se recarga automáticamente** en
   próximas sesiones y en el proyecto guardado.
4. Formatos aceptados: 8 760 valores, 8 784 (año bisiesto), 24 (perfil diario),
   12 (perfil mensual) o cualquier longitud (remuestreo lineal). Separador
   `,` o `;`, decimal con punto o coma, cabecera opcional, comentarios `#`.

## Modelo físico

- **Celda**: `E = E_rev(T,p) + η_act + η_ohm + η_conc + ΔV_deg`
  con `η_act = (RT/αnF)·asinh(j/2j₀)`, `η_ohm = j·ASR`, `η_conc = (RT/2F)·ln(j_lim/(j_lim−j))`.
- **Consumo específico**: `26,5914 · V_celda / η_F(L)` kWh/kg.
- **Compresión**: Peng-Robinson para `Z`, modelo politrópico multietapa con
  intercooling; `T₂ = T₁·r^((k−1)/(k·η_p))`.
- **Exergía**: exergía química del H₂ = 32,53 kWh/kg; exergía térmica por Carnot.
- **Economía**: LCOH nivelado `Σ(CAPEX+OPEX+E·p)/(1+r)^t ÷ Σ kg/(1+r)^t`.

## Kernel WebAssembly (opcional)

El bucle horario ya se ejecuta en JavaScript optimizado (arrays tipados +
tabla característica precalculada) en pocos milisegundos para 20 años × 8 760 h.
Si desea acelerarlo aún más, compile un módulo con la exportación:

```
simulate_year(
  pv_kwp: f64, pr: f64, wind_kw: f64, p_nom_mw: f64,
  inv: f64, rect: f64, bop: f64, min_load: f64, allow_grid: f64,
  solar_ptr: i32, wind_ptr: i32, out_ptr: i32, n: i32
) -> f64   // kg producidos
```

Coloque el binario como `./h2kernel.wasm` junto a `index.html`. La aplicación lo
detecta automáticamente y lo indica en el chip **Motor**; si no existe, usa el
kernel JS sin pérdida de resultados.

## Limitaciones

Herramienta de prefactibilidad. No sustituye al diseño de detalle, a un estudio
de integración eléctrica ni a una certificación RFNBO. Los valores precargados
de la librería de equipos son **orientativos** y deben sustituirse por datos de
ficha técnica del fabricante.
