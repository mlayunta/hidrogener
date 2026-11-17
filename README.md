# H₂ Verde

**Aplicación web progresiva de prefactibilidad para proyectos de
hidrógeno renovable.**

Autor: **Miguel Ángel Layunta López**

H₂ Verde permite explorar escenarios preliminares de producción
de hidrógeno renovable a partir de las hipótesis y los recursos
introducidos por el usuario.

Su propósito es apoyar el análisis inicial y la comparación de
alternativas. No sustituye la ingeniería de detalle, un estudio
económico contractual ni la evaluación regulatoria de un proyecto.

## Estado y alcance

- Las versiones autocontenidas 3.0 y 3.1 se han comprobado como
  funcionales en uso por el autor.
- La versión 3.1 incorpora pruebas internas obligatorias,
  sensibilidad y expedientes con SHA-256.
- Se ha propuesto una evolución 3.2 con calendario UTC, validación
  de series y curvas JSON de consumo DC.
- La implementación y compatibilidad de esas funciones deben
  comprobarse en la versión concreta de la aplicación publicada.
- La herramienta complementaria `h2recursos.html`, con la corrección
  de sintaxis, se ha comprobado como funcional en el navegador
  del autor.

Estas comprobaciones de funcionamiento no constituyen una
validación experimental del modelo ni una certificación independiente.

## Acceso

Desde la página publicada del proyecto:

- Aplicación principal: [abrir aplicación](./).
- Preparación de recursos: [abrir herramienta](./h2recursos.html).

La instalación como PWA depende del navegador, del manifiesto,
del service worker y de que el sitio se publique en un contexto
seguro, normalmente HTTPS.

## Herramienta de preparación de recursos

`h2recursos.html` prepara:

1. Producción fotovoltaica horaria modelada por PVGIS.
2. Precios eléctricos desde un CSV previamente normalizado.
3. Un CSV horario UTC para el importador compatible de H₂ Verde.
4. Un expediente JSON de procedencia y transformaciones,
   con hashes SHA-256 cuando están disponibles.

La herramienta no interpreta formatos nativos de OMIE ni XML
de ENTSO-E. No incorpora preparación de recurso eólico.

### Importar producción FV de PVGIS

1. Introducir latitud, longitud y año.
2. Obtener de PVGIS un JSON de producción FV horaria.
3. Seleccionar el JSON original completo en el apartado 2.
4. Aceptar expresamente la asignación temporal si los registros
   tienen minutos distintos de cero.
5. Pulsar **Preparar recursos**.
6. Descargar el CSV y el expediente antes de cerrar o refrescar.

El archivo debe contener:

- `outputs.hourly`.
- La variable `P`, expresada en W.
- `inputs.pv_module.peak_power`, expresada en kWp.
- Coordenadas compatibles con las indicadas.
- Un calendario completo del año seleccionado.

Un JSON de perfil de horizonte solar no es una serie de
producción FV y no sirve para este importador.

### Tratamiento de la producción FV

El perfil se normaliza dividiendo la producción en W entre
la potencia nominal de referencia en kWp multiplicada por 1000.

La herramienta:

- Comprueba la cobertura anual.
- Rechaza registros duplicados o desordenados.
- No rellena huecos.
- No recorta silenciosamente la producción.
- Rechaza factores superiores a 1 por la restricción del
  formato objetivo.
- Conserva los parámetros originales de PVGIS en el expediente.

PVGIS proporciona producción modelada, no mediciones de una
instalación.

Los campos de inclinación, azimut y pérdidas generan la solicitud
a PVGIS. No recalculan la producción de un JSON ya descargado.

### Marcas temporales con minutos

Algunos archivos PVGIS contienen marcas como `20230101:0810`.

Si el usuario acepta la transformación, el registro se asigna
al intervalo que comienza a las `08:00:00Z` de ese día.

Esta asignación:

- Conserva el valor de producción.
- Queda registrada en el expediente.
- Es una aproximación temporal.
- No acredita coincidencia subhoraria ni cumplimiento regulatorio.

### Precios eléctricos opcionales

El formato obligatorio utiliza punto y coma:

```csv
fecha_utc;duracion_min;precio_eur_mwh
2023-01-01T00:00:00Z;60;80,25
2023-01-01T01:00:00Z;60;76,50
