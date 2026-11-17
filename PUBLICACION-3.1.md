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
