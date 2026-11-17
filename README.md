# H₂ Verde · Modelo consolidado 3.0

Autor: Miguel Ángel Layunta López.

## Finalidad

Herramienta preliminar para explorar escenarios de producción de
hidrógeno renovable y su economía.

Esta versión sustituye la arquitectura anterior de módulos encadenados.
No carga los archivos h2all.js, h2modules.js, h2agua.js, h2despacho.js,
h2termico.js, h2datos.js, h2gemelo.js ni un kernel WebAssembly.

## Archivos activos

- index.html
- sw.js
- manifest.json
- icon.svg
- README.md

## Ejecución

Desde la carpeta:

    python -m http.server 8080

Abrir localhost en el puerto 8080.

No abrir mediante file:// para instalar la PWA.

En producción se necesita HTTPS.

## Estado de comprobación

La entrega incluye comprobaciones internas accesibles en
“Modelo y pruebas”.

El código entregado no ha sido ejecutado en un navegador durante
la conversación en la que se generó.

Las comprobaciones internas no equivalen a validación experimental,
certificación ni pruebas de compatibilidad en todos los navegadores.

## Funciones incluidas

- Simulación horaria de 8.760 intervalos.
- Recurso solar y eólico sintético.
- Importación explícita de factores horarios y precios.
- Consumo específico DC declarado.
- Degradación según horas efectivas.
- Reposición física del stack.
- Compresión isotérmica aproximada.
- Agua de proceso y tratamiento eléctrico.
- Oxígeno producido y comercializado.
- Batería AC mediante reglas de carga y descarga.
- Balance eléctrico horario y anual.
- CAPEX inicial en año cero.
- Flujos anuales, LCOH bruto y neto, VAN.
- TIR de flujos convencionales.
- Primera recuperación simple.
- Proyectos con series incorporadas.
- Exportación JSON, CSV e informe HTML.
- Impresión para generar PDF.
- Disponibilidad local mediante service worker.

## Funciones no incluidas

- Modelo electroquímico de celda y calibración de fabricante.
- SOEC y suministro de vapor.
- Licuefacción y portadores.
- Balance térmico o exergético.
- Recuperación de calor.
- Arranques, rampas y tiempos mínimos de permanencia.
- Optimización MILP o programación dinámica.
- Monte Carlo o índices de Sobol.
- Gemelo digital con validación temporal.
- Certificación RFNBO.
- Comparación económica independiente con electrificación directa.
- Exportación de un libro Excel auténtico.

No se deben interpretar funciones retiradas como resultados
implícitamente validados.

## Unidades

- Potencias: kW.
- Energía de un intervalo de una hora: kWh.
- Hidrógeno: kg por intervalo.
- Batería nominal: MWh en el formulario; kWh internos.
- Precios eléctricos: €/MWh.
- Emisiones parciales: gCO₂eq/MJ de H₂ entregado.
- Presiones: bar absolutos.

## Electrolizador

Se declara un consumo específico DC inicial en kWh/kg.

La degradación incrementa el consumo según la edad operativa.
La edad aumenta una hora por cada intervalo con producción.

Al alcanzar la vida operativa:
- Se repone el stack.
- Se reinicia su edad.
- Se contabiliza el coste en el flujo al cierre del año.

No se modela la indisponibilidad durante la reposición.

El consumo específico y la carga mínima necesitan datos adecuados
al equipo y a su perímetro.

## Compresión

Modelo de gas ideal isotérmico:

Trabajo específico proporcional a:
- Constante específica del H₂.
- Temperatura absoluta.
- Logaritmo del cociente de presiones.
- Inverso del rendimiento global declarado.

Si la presión de entrega no supera la de salida del stack,
no se calcula trabajo de compresión.

No modela descarga, etapas, propiedades reales ni diseño mecánico.
Debe sustituirse por consumos de equipo validados cuando estén disponibles.

## Batería

Conectada al bus AC.

- Carga exclusivamente desde excedentes renovables.
- No carga desde la red.
- Descarga para atender la demanda seleccionada.
- Rendimientos de carga y descarga iguales a la raíz del rendimiento
  de ida y vuelta.
- Inventario inicial utilizable igual a cero.
- Inventario conservado entre años.
- Variación de inventario incluida en el balance.
- Inventario final sin valor residual.

El despacho no es óptimo.

La vida económica permite reposiciones completas.
No se modela degradación física de capacidad ni potencia.

## Agua y oxígeno

Agua de proceso en L/kg H₂.
No constituye por sí sola la huella hídrica completa de una planta.

Oxígeno producido calculado mediante relación de masas molares.
La venta se calcula sobre H₂ producido, no entregado.

La fracción comercializada inicial es cero.

El usuario debe justificar:
- Comprador.
- Pureza y especificación.
- Infraestructura.
- Consumos de acondicionamiento.
- Costes de entrega.

El CAPEX de planta debe incluir los sistemas utilizados.

## Economía

CAPEX inicial una sola vez en año cero.

Flujos anuales al cierre de cada año.

Convenciones nominales:
- Descuento nominal.
- Escalado de electricidad separado.
- Escalado de OPEX y ventas.

No incluye impuestos, subvenciones, financiación específica ni
valor residual.

El coste marginal renovable no debe duplicar amortización u OPEX
incluidos en otros parámetros.

LCOH bruto:
Costes descontados divididos por H₂ entregado descontado.

LCOH neto:
Costes descontados menos ingresos descontados por O₂,
divididos por H₂ entregado descontado.

La TIR solo se informa para flujos convencionales.
La primera recuperación simple no garantiza recuperación permanente
después de reposiciones posteriores.

## CSV de series

Separador: punto y coma.
Cabecera obligatoria.
Exactamente 8.760 filas.

Columna obligatoria:
- hora: enteros consecutivos de 0 a 8759.

Columnas opcionales:
- solar: factor [0,1].
- eolica: factor [0,1].
- precio_eur_mwh: precio explícito.

Debe existir al menos una columna opcional.

Las columnas ausentes usan el recurso sintético o el precio plano.

Se permite punto o coma decimal.
No se interpolan datos incompletos.
No se recortan años bisiestos.
No se deducen unidades por magnitud.

Los factores corresponden al recurso eléctrico antes del rendimiento
común declarado. No importar directamente irradiancia en W/m².

Una descarga PVGIS requiere conversión y verificación de su perímetro
antes de utilizarse como factor en este modelo.

## Proyectos

El formato consolidado 3.0 es independiente del formato antiguo.

No se importan silenciosamente proyectos anteriores porque sus
parámetros tienen significados distintos.

Los proyectos guardan parámetros y series importadas.

El almacenamiento local:
- No es una copia de seguridad.
- Puede llenarse o ser eliminado.
- No se comparte entre dispositivos.
- Depende del origen del sitio.

Exportar JSON como copia de seguridad.

## PWA y actualizaciones

El service worker precarga solo los archivos activos.

Una actualización espera a que se cierren las ventanas anteriores.
No se mezclan deliberadamente archivos de publicaciones diferentes.

Cambiar RELEASE en sw.js al publicar cualquier modificación.

Subir todos los archivos conjuntamente.
Preferir despliegues atómicos.

Los iconos SVG no garantizan idéntica compatibilidad de instalación
en todos los dispositivos.

## Límites de uso

No sustituye:
- Diseño de detalle.
- Garantía de rendimiento.
- Evaluación de ciclo de vida.
- Certificación RFNBO.
- Estudio financiero independiente.
- Validación del fabricante.


---

# Publicación profesional 3.1

## Archivos activos

- index.html
- h2professional.js
- sw.js
- manifest.json
- icon.svg

## Instalación

Servir la carpeta con:

    python -m http.server 8080

Abrir localhost en el puerto 8080.

En producción se requiere HTTPS.

## Compatibilidad

Acepta proyectos consolidados 3.0 y 3.1.
No convierte proyectos del programa modular antiguo.

La biblioteca local conserva la clave de almacenamiento de la base 3.0.
Si se utiliza otro origen, dominio o puerto, el navegador utiliza otro
almacenamiento. Exportar JSON antes de cambiar de origen.

## Pruebas

La aplicación ejecuta comprobaciones analíticas al iniciar.
Si falla alguna comprobación obligatoria, bloquea el cálculo profesional.

Consultar la pestaña Calidad y trazabilidad.

Superar estas pruebas no equivale a:
- Validación experimental.
- Certificación RFNBO.
- Garantía de rendimiento.
- Auditoría financiera externa.
- Pruebas exhaustivas de seguridad o compatibilidad.

## Expediente reproducible

La exportación contiene:
- Parámetros del resultado calculado.
- Series horarias utilizadas.
- Resultados anuales.
- Flujos de caja.
- Estado y resultados de pruebas.
- Hipótesis y límites.
- Sensibilidad, si pertenece al mismo resultado.

Cuando Web Crypto está disponible, se añade una huella SHA-256.

La huella comprueba integridad del contenido, no validez científica.
El hash se calcula sobre el campo payload serializado con claves de
objetos ordenadas. Los números no finitos se representan como null.

## Sensibilidad

Usa el motor completo.

Variaciones univariantes relativas de ±10 %:
- Consumo específico DC.
- CAPEX renovable.
- Tasa de descuento.

Las series importadas se mantienen constantes.
No equivale a incertidumbre probabilística ni optimización.

Una alternativa fuera de límites se informa como no calculable.
No se recorta silenciosamente.

## Actualización

Cambiar RELEASE en sw.js para una publicación diferente.

Subir todos los archivos conjuntamente.
Preferir despliegues atómicos.

La actualización espera a que se cierren las ventanas anteriores.

## Estado de entrega

Código generado y revisado estáticamente durante su preparación.
Su ejecución y comprobaciones se realizan en el navegador del usuario.

## Límites conservados

Consumo DC declarado, electrólisis de baja temperatura.
Compresión isotérmica aproximada.
Despacho de batería por reglas.
Sin modelo térmico, SOEC, portadores, licuefacción ni RFNBO.
Sin envejecimiento físico de capacidad de batería.
Sin indisponibilidad durante reposiciones.
