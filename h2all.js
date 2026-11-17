/* =====================================================================
   H2 VERDE · Cargador único de módulos · v1
   Carga en orden los seis módulos de extensión y evita que cada uno
   dispare un recálculo completo durante el arranque.
   Instalación: sustituir las seis etiquetas <script> por esta sola:
       <script src="./h2all.js"></script>
   ===================================================================== */
(function () {
"use strict";

var VERSION = "v1";

var FILES = [
  "./h2modules.js",   /* validación, rainflow, Monte Carlo, Sobol   */
  "./h2agua.js",      /* agua y oxígeno como coproducto             */
  "./h2despacho.js",  /* batería y despacho óptimo por DP           */
  "./h2termico.js",   /* térmica y arranques                        */
  "./h2datos.js",     /* PVGIS y precios horarios reales            */
  "./h2gemelo.js"     /* gemelo digital y diagnóstico               */
];

/* ---------------------------------------------------------------------
   EL ORDEN IMPORTA. h2despacho debe cargarse ANTES que h2termico:
   el despacho óptimo sustituye simYear por completo, y la capa térmica
   tiene que envolver ese resultado para poder añadir la energía de
   arranque. Si se invierte, la energía de arranque desaparece del
   balance cuando la batería está activa.
   --------------------------------------------------------------------- */

var loading = true;
var realRecalc = window.recalc || function () {};
var loaded = 0;

/* Guardia: durante la carga, cualquier recalc() se ignora. Los módulos
   siguen encadenando sus parches con normalidad, pero no se lanza la
   simulación hasta que todos están dentro. */
window.recalc = function () {
  if (loading) return;
  return realRecalc.apply(this, arguments);
};

/* Chip de progreso en la cabecera */
function chip(txt, cls) {
  var chips = document.querySelector("header.app .chips");
  if (!chips) return;
  var c = document.getElementById("chipAll");
  if (!c) {
    c = document.createElement("span");
    c.id = "chipAll";
    chips.appendChild(c);
  }
  c.className = "chip " + (cls || "");
  c.textContent = txt;
}
chip("Módulos 0/" + FILES.length, "warn");

/* Carga secuencial: cada módulo termina antes de empezar el siguiente */
var idx = 0;
function loadNext() {
  if (idx >= FILES.length) { waitReady(); return; }
  var s = document.createElement("script");
  s.src = FILES[idx++];
  s.async = false;
  s.onload = function () {
    loaded++;
    chip("Módulos " + loaded + "/" + FILES.length, loaded === FILES.length ? "ok" : "warn");
    loadNext();
  };
  s.onerror = function () {
    if (window.console) console.warn("[h2all] no se pudo cargar " + s.src);
    loadNext();
  };
  document.head.appendChild(s);
}

/* Espera a que la aplicación esté lista, libera la guardia y recalcula
   una sola vez. Rescate a los ~4,8 s si algo no responde. */
var tries = 0;
function waitReady() {
  tries++;
  var ready = document.getElementById("projSelect") || tries > 60;
  if (!ready) { setTimeout(waitReady, 80); return; }
  setTimeout(function () {
    loading = false;
    try { window.recalc(); } catch (e) {}
    if (window.console) console.log("[h2all] " + VERSION + " · " + loaded + " de " + FILES.length + " módulos cargados");
  }, 300);
}

window.H2ALL = {
  version: VERSION,
  files: FILES,
  get loaded() { return loaded; }
};

loadNext();
})();
