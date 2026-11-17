(function(){
"use strict";

const RELEASE = "3.1";
const ENGINE_ID = "h2verde-consolidado-3.1";
const HOURS_PER_YEAR = 8760;

if (
  typeof calculate !== "function" ||
  typeof renderResults !== "function" ||
  typeof annualSimulation !== "function" ||
  typeof validateConfig !== "function"
) {
  throw new Error("La extensión profesional no encuentra el núcleo esperado.");
}

const baseCalculate = calculate;
const baseRenderResults = renderResults;

let health = {
  passed: false,
  executedAt: null,
  cases: []
};

let busySensitivity = false;
let sensitivityOutput = null;

const clone = value => JSON.parse(JSON.stringify(value));

function htmlEscape(value){
  return String(value).replace(/[&<>"']/g, character => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[character]));
}

function numberFormat(value, decimals){
  if (!Number.isFinite(value)) return "No definido";
  return new Intl.NumberFormat("es-ES",{
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function makePanel(){
  const nav = document.querySelector("nav");
  const main = document.querySelector("main");

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role","tab");
  button.dataset.tab = "calidad";
  button.setAttribute("aria-selected","false");
  button.tabIndex = -1;
  button.textContent = "Calidad y trazabilidad";
  nav.appendChild(button);

  const panel = document.createElement("section");
  panel.id = "panel-calidad";
  panel.className = "panel";
  panel.hidden = true;

  panel.innerHTML =
    '<div class="card">' +
      '<h2>Estado del motor</h2>' +
      '<div id="professionalHealth"></div>' +
      '<div class="toolbar">' +
        '<button id="professionalTests" type="button">Repetir pruebas obligatorias</button>' +
        '<button id="professionalAudit" type="button">Exportar expediente reproducible</button>' +
      '</div>' +
      '<p>Las pruebas verifican propiedades concretas del código. ' +
      'No certifican parámetros de fabricante ni rendimiento de una planta real.</p>' +
      '<div id="professionalCases" class="scroll"></div>' +
    '</div>' +
    '<div class="card">' +
      '<h2>Sensibilidad del escenario calculado</h2>' +
      '<p>Se utiliza el mismo motor completo. Cada alternativa conserva una copia ' +
      'de las series del resultado base. No se cambia el proyecto abierto.</p>' +
      '<p>Variación de ±10 %. Los cambios en consumo específico, tasa de descuento ' +
      'y CAPEX renovable son análisis separados, no una distribución probabilística.</p>' +
      '<div class="toolbar">' +
        '<button id="professionalSensitivity" type="button">Evaluar sensibilidad</button>' +
      '</div>' +
      '<div id="professionalSensitivityStatus" role="status" aria-live="polite"></div>' +
      '<div id="professionalSensitivityTable" class="scroll"></div>' +
    '</div>' +
    '<div class="card">' +
      '<h2>Lectura profesional del resultado</h2>' +
      '<div id="professionalWarnings"></div>' +
      '<p><strong>Estado:</strong> modelo de prefactibilidad. ' +
      'No existe todavía una validación independiente contra datos operativos ' +
      'alineados ni una evaluación regulatoria.</p>' +
      '<p>No se afirma optimalidad del despacho, garantía de rendimiento, ' +
      'certificación RFNBO ni exactitud de propiedades reales del hidrógeno.</p>' +
    '</div>';

  main.appendChild(panel);
}

function analyticConfig(){
  return Object.assign({}, DEFAULTS, {
    name:"Caso analítico",
    years:1,
    pv:100,
    wind:0,
    inv:100,
    rect:100,
    bop:0,
    stack:100,
    sec:50,
    minimum:0,
    deg:0,
    stackLife:100000,
    replacement:0,
    pIn:1,
    pOut:1,
    waterEnergy:0,
    waterPrice:0,
    o2Capture:0,
    o2Energy:0,
    o2Cost:0,
    gridMode:"off",
    battery:false,
    capRenew:1000,
    capStack:0,
    capPlant:0,
    fixed:0,
    renewPrice:0,
    rate:0,
    inflation:0,
    elecEsc:0,
    h2Price:1,
    loss:0,
    otherCI:0,
    renewCI:0,
    gridCI:0
  });
}

function constantSeries(solarValue, windValue){
  return {
    name:"Serie analítica constante",
    solar:new Array(HOURS_PER_YEAR).fill(solarValue),
    wind:new Array(HOURS_PER_YEAR).fill(windValue)
  };
}

function executeTests(){
  const cases = [];

  function test(name, callback){
    try {
      callback();
      cases.push({name:name, passed:true, detail:"Resultado esperado alcanzado"});
    } catch(error) {
      cases.push({
        name:name,
        passed:false,
        detail:error.message || String(error)
      });
    }
  }

  function close(actual, expected, name, tolerance){
    const limit = tolerance === undefined
      ? 1e-8 * Math.max(1, Math.abs(expected))
      : tolerance;

    if (
      !Number.isFinite(actual) ||
      Math.abs(actual - expected) > limit
    ) {
      throw new Error(
        name + ": esperado " + expected + ", obtenido " + actual
      );
    }
  }

  const config = analyticConfig();
  const series = constantSeries(1,0);

  test("Producción analítica y energía DC", function(){
    const r = baseCalculate(config, series);
    close(r.rows[0].a.stack, 876000, "Energía DC");
    close(r.rows[0].a.kg, 17520, "H₂ producido");
    close(r.rows[0].a.delivered, 17520, "H₂ entregado");
  });

  test("CAPEX una sola vez en año cero", function(){
    const r = baseCalculate(config, series);
    close(r.npvCosts,1000,"Costes descontados");
    close(r.grossLcoh,1000/17520,"LCOH bruto");
    close(r.npv,17520-1000,"VAN");
  });

  test("Descuento anual con solución conocida", function(){
    const c = Object.assign({},config,{years:2,rate:10});
    const r = baseCalculate(c,series);
    const discountedKg = 17520/1.1 + 17520/(1.1*1.1);
    close(r.npvKg,discountedKg,"Producción descontada");
    close(r.grossLcoh,1000/discountedKg,"LCOH descontado");
    close(r.npv,discountedKg-1000,"VAN descontado");
  });

  test("Sin recurso ni red: producción nula", function(){
    const r = baseCalculate(config,constantSeries(0,0));
    close(r.rows[0].a.kg,0,"Producción");
    close(r.rows[0].a.grid,0,"Importación");
    if (Number.isFinite(r.netLcoh)) {
      throw new Error("El LCOH sin producción no debe ser un número finito.");
    }
  });

  test("Red a potencia nominal y coste horario", function(){
    const c = Object.assign({},config,{
      pv:0,
      gridMode:"nominal",
      gridPrice:100
    });
    const r = baseCalculate(c,constantSeries(0,0));
    close(r.rows[0].a.grid,876000,"Electricidad de red");
    close(r.rows[0].electricity,87600,"Coste eléctrico");
  });

  test("Oxígeno independiente de pérdidas de entrega", function(){
    const c = Object.assign({},config,{
      loss:20,
      o2Capture:50,
      o2Price:80,
      o2Energy:0,
      o2Cost:0
    });
    const r = baseCalculate(c,series);
    const oxygen = 17520 * O2_RATIO;
    close(r.rows[0].a.o2Produced,oxygen,"O₂ producido");
    close(r.rows[0].a.o2Sold,oxygen*0.5,"O₂ comercializado");
    close(r.rows[0].oxygenRevenue,oxygen*0.5/1000*80,"Ingreso O₂");
    close(r.rows[0].a.delivered,17520*0.8,"H₂ entregado");
  });

  test("Reposición física y coste económico coherentes", function(){
    const c = Object.assign({},config,{
      stackLife:1000,
      replacement:100
    });
    const r = baseCalculate(c,series);
    close(r.rows[0].a.replacements,8,"Reposiciones físicas");
    close(r.rows[0].replacements,800,"Coste de reposición");
    close(r.rows[0].a.ageFinal,760,"Edad final");
  });

  test("Balance de batería con inventario explícito", function(){
    const c = Object.assign({},config,{
      pv:200,
      battery:true,
      batCap:1,
      batPower:0.1,
      batEff:90,
      socMin:10,
      socMax:90,
      batCapex:0,
      batOpex:0
    });

    const data = {
      name:"Alternancia diaria",
      solar:Array.from(
        {length:HOURS_PER_YEAR},
        function(_,hour){ return hour%24<12 ? 1 : 0; }
      ),
      wind:new Array(HOURS_PER_YEAR).fill(0)
    };

    const r = baseCalculate(c,data);
    const a = r.rows[0].a;

    close(a.residual,0,"Residuo eléctrico",1e-5);
    close(a.socInitial,0,"Inventario inicial utilizable");

    if (a.batteryLoss < 0 || a.socFinal < 0 || a.socFinal > 800 + 1e-7) {
      throw new Error("Pérdidas o inventario no físicos.");
    }

    if (a.charged <= 0 || a.discharged <= 0) {
      throw new Error("El caso no ejercita carga y descarga.");
    }
  });

  test("Emisiones: conversión correcta a MJ", function(){
    const c = Object.assign({},config,{
      pv:0,
      gridMode:"nominal",
      gridCI:100
    });

    const r = baseCalculate(c,constantSeries(0,0));
    const expected = 100 * 50 / (LHV * 3.6);

    close(r.rows[0].a.ci,expected,"Intensidad g/MJ");
  });

  test("Compresión nula a presión de entrega inferior", function(){
    const c = Object.assign({},config,{pIn:30,pOut:1});
    close(compression(c),0,"Compresión");
  });

  test("Resultados independientes de objetos de entrada", function(){
    const input = Object.assign({},config);
    const data = constantSeries(1,0);
    const r = baseCalculate(input,data);

    input.sec = 100;
    data.solar[0] = 0;

    close(r.c.sec,50,"Parámetro del resultado");
    close(r.data.solar[0],1,"Serie del resultado");
    close(r.rows[0].a.kg,17520,"Resultado calculado");
  });

  health = {
    passed:cases.every(item=>item.passed),
    executedAt:new Date().toISOString(),
    cases:cases
  };

  renderHealth();
  return health;
}

function renderHealth(){
  const summary = document.getElementById("professionalHealth");
  const table = document.getElementById("professionalCases");

  const passed = health.cases.filter(item=>item.passed).length;

  summary.innerHTML =
    '<div class="note '+(health.passed?'good':'')+'">' +
    '<strong>'+passed+' de '+health.cases.length+
    ' comprobaciones obligatorias superadas.</strong>' +
    '<p>'+(
      health.passed
      ? 'El motor puede calcular. Este estado se refiere a pruebas del código, no a validación experimental.'
      : 'El cálculo profesional está bloqueado hasta resolver los fallos.'
    )+'</p>' +
    '<p>Ejecutadas: '+htmlEscape(health.executedAt || "No ejecutadas")+'</p>' +
    '</div>';

  table.innerHTML =
    '<table><thead><tr><th>Comprobación</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>' +
    health.cases.map(item=>
      '<tr><td>'+htmlEscape(item.name)+'</td><td>'+
      (item.passed?'Superada':'Fallo')+'</td><td>'+
      htmlEscape(item.detail)+'</td></tr>'
    ).join("") +
    '</tbody></table>';
}

function warningsFor(r){
  const c = r.c;
  const a = r.rows[0].a;
  const warnings = [];

  warnings.push(
    "El consumo específico es un dato declarado: no se ha calibrado contra un fabricante."
  );

  if (!r.data || !r.data.solar) {
    warnings.push(
      "El recurso solar es sintético. No equivale a una serie meteorológica medida."
    );
  }

  if (c.wind > 0 && (!r.data || !r.data.wind)) {
    warnings.push(
      "El recurso eólico es sintético. Su factor de capacidad no valida su patrón horario."
    );
  }

  if (c.pOut > c.pIn) {
    warnings.push(
      "La compresión es isotérmica de gas ideal. El consumo necesita contraste con equipo real, especialmente a alta presión."
    );
  }

  if (c.battery) {
    warnings.push(
      "El despacho de batería utiliza reglas. No se ha demostrado que minimice el LCOH."
    );

    warnings.push(
      "No se modela pérdida física de capacidad de batería ni indisponibilidad por reposición."
    );
  }

  if (c.o2Capture > 0) {
    warnings.push(
      "El ingreso de O₂ exige comprador, pureza, condiciones de entrega y CAPEX de acondicionamiento justificados."
    );
  }

  if (c.gridMode !== "off") {
    warnings.push(
      "Permitir red no acredita el origen renovable de toda la producción."
    );
  }

  if (a.operating > 0 && c.minimum === 0) {
    warnings.push(
      "La carga mínima es cero. Debe verificarse si el equipo admite ese supuesto."
    );
  }

  if (r.rows.some(row=>row.a.replacements>0)) {
    warnings.push(
      "Se han calculado reposiciones de stack; no se descuenta tiempo de parada durante su ejecución."
    );
  }

  if (Number.isFinite(r.netLcoh) && r.netLcoh < 0) {
    warnings.push(
      "El LCOH neto es negativo por créditos de coproductos. No significa que la planta carezca de costes."
    );
  }

  if (!Number.isFinite(r.irr)) {
    warnings.push(
      "No se informa TIR. Puede faltar un flujo convencional o una raíz en el intervalo de búsqueda."
    );
  }

  if (a.kg === 0) {
    warnings.push(
      "No existe producción en el primer año. No interpretar un LCOH no definido como coste cero."
    );
  }

  warnings.push(
    "Las emisiones publicadas son parciales. No constituyen una evaluación de ciclo de vida ni certificación RFNBO."
  );

  return warnings;
}

function provenance(r){
  return {
    application:ENGINE_ID,
    release:RELEASE,
    calculatedAt:r.created,
    period:{
      intervalsPerYear:HOURS_PER_YEAR,
      intervalHours:1,
      modeledYears:r.c.years,
      calendar:"Año normalizado sin fechas; no acredita alineación UTC ni año bisiesto"
    },
    inputSources:{
      solar:r.data && r.data.solar?"Importada":"Sintética",
      wind:r.data && r.data.wind?"Importada":"Sintética",
      prices:r.data && r.data.prices?"Importados":"Precio plano",
      importedName:r.data?r.data.name:null
    },
    modelStatus:{
      electricalBalances:"Comprobados dentro del motor",
      regressionTests:"Resultados de ejecución adjuntos",
      experimentalValidation:"No realizada",
      optimalDispatch:"No afirmado",
      regulatoryCertification:"No realizada"
    },
    warnings:warningsFor(r),
    tests:clone(health)
  };
}

calculate = function(c,data){
  if (!health.passed) {
    throw new Error(
      "Motor bloqueado: las comprobaciones obligatorias no han sido superadas."
    );
  }

  const r = baseCalculate(c,data);
  r.professional = provenance(r);
  return r;
};

renderResults = function(r){
  baseRenderResults(r);

  sensitivityOutput = null;
  document.getElementById("professionalSensitivityTable").innerHTML = "";
  document.getElementById("professionalSensitivityStatus").textContent =
    "Sensibilidad pendiente para este resultado.";

  const warnings = r.professional
    ? r.professional.warnings
    : warningsFor(r);

  document.getElementById("professionalWarnings").innerHTML =
    '<ul>'+warnings.map(text=>'<li>'+htmlEscape(text)+'</li>').join("")+'</ul>';

  const report = document.getElementById("report");
  const auditCard = document.createElement("div");
  auditCard.className = "card";

  auditCard.innerHTML =
    '<h2>Trazabilidad y límites de la publicación '+RELEASE+'</h2>'+
    '<p>Motor: '+htmlEscape(ENGINE_ID)+'</p>'+
    '<p>Comprobaciones obligatorias: '+
    (health.passed?'superadas en esta sesión':'no superadas')+'</p>'+
    '<ul>'+warnings.map(text=>'<li>'+htmlEscape(text)+'</li>').join("")+'</ul>'+
    '<p>El expediente JSON contiene entradas, series utilizadas y resultados anuales. '+
    'Su huella de integridad no certifica la corrección científica.</p>';

  report.appendChild(auditCard);
};

function canonicalJSON(value){
  if (value === null) return "null";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "["+value.map(canonicalJSON).join(",")+"]";
  }

  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{"+keys.map(key=>
      JSON.stringify(key)+":"+canonicalJSON(value[key])
    ).join(",")+"}";
  }

  throw new Error("Dato no serializable en el expediente.");
}

async function digest(text){
  if (!globalThis.crypto || !crypto.subtle) {
    return null;
  }

  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256",bytes);

  return Array.from(new Uint8Array(hash),byte=>
    byte.toString(16).padStart(2,"0")
  ).join("");
}

function auditPayload(r){
  return {
    schema:"h2verde-audit-1",
    engine:ENGINE_ID,
    release:RELEASE,
    calculatedAt:r.created,
    config:clone(r.c),
    profiles:{
      name:r.profiles.description,
      solar:Array.from(r.profiles.solar),
      wind:Array.from(r.profiles.wind),
      pricesEurMwh:Array.from(r.profiles.prices)
    },
    importedSeries:r.data?clone(r.data):null,
    annual:r.rows.map(row=>({
      year:row.y,
      hydrogenProducedKg:row.a.kg,
      hydrogenDeliveredKg:row.a.delivered,
      gridKwh:row.a.grid,
      renewableKwh:row.a.renewable,
      stackDCKwh:row.a.stack,
      batteryLossKwh:row.a.batteryLoss,
      batteryInventoryChangeKwh:row.a.deltaSOC,
      electricalResidualKwh:row.a.residual,
      waterM3:row.a.waterM3,
      oxygenProducedKg:row.a.o2Produced,
      oxygenSoldKg:row.a.o2Sold,
      stackReplacements:row.a.replacements,
      operatingHours:row.a.operating,
      replacementCostsEur:row.replacements,
      electricityCostsEur:row.electricity,
      costsEur:row.costs,
      hydrogenRevenueEur:row.h2Revenue,
      oxygenRevenueEur:row.oxygenRevenue,
      cashFlowEur:row.cash,
      partialEmissionsGPerMJ:Number.isFinite(row.a.ci)?row.a.ci:null
    })),
    economics:{
      initialCapexEur:r.initialCapex,
      grossLcohEurKg:Number.isFinite(r.grossLcoh)?r.grossLcoh:null,
      netLcohEurKg:Number.isFinite(r.netLcoh)?r.netLcoh:null,
      npvEur:r.npv,
      irr:Number.isFinite(r.irr)?r.irr:null,
      firstSimplePaybackYears:Number.isFinite(r.payback)?r.payback:null,
      cashFlowsEur:Array.from(r.cashFlows)
    },
    provenance:r.professional || provenance(r),
    sensitivity:sensitivityOutput &&
      sensitivityOutput.baseCalculatedAt===r.created
      ? clone(sensitivityOutput)
      : null
  };
}

async function exportAudit(){
  if (calculating || busySensitivity) {
    throw new Error("Espere a que termine el cálculo.");
  }

  if (!result) {
    throw new Error("Calcule un resultado válido antes de exportar.");
  }

  const payload = auditPayload(result);
  const serialized = canonicalJSON(payload);
  const sha256 = await digest(serialized);

  const envelope = {
    integrity:{
      algorithm:sha256?"SHA-256":"No disponible",
      serialization:"Claves de objetos ordenadas; números no finitos como null",
      payloadSha256:sha256,
      meaning:"Comprueba integridad del contenido; no certifica su validez científica"
    },
    payload:payload
  };

  download(
    "h2verde-expediente-3.1.json",
    JSON.stringify(envelope,null,2),
    "application/json"
  );

  status(
    sha256
    ? "Expediente exportado con huella SHA-256."
    : "Expediente exportado sin huella: Web Crypto no disponible."
  );
}

function renderSensitivity(output){
  const header =
    '<table><thead><tr>'+
    '<th>Alternativa</th><th>LCOH neto €/kg</th>'+
    '<th>Δ LCOH €/kg</th><th>VAN €</th><th>Estado</th>'+
    '</tr></thead><tbody>';

  const rows = output.rows.map(row=>
    '<tr>'+
    '<td>'+htmlEscape(row.label)+'</td>'+
    '<td>'+numberFormat(row.lcoh,3)+'</td>'+
    '<td>'+numberFormat(row.delta,3)+'</td>'+
    '<td>'+numberFormat(row.npv,0)+'</td>'+
    '<td>'+htmlEscape(row.error || "Calculado")+'</td>'+
    '</tr>'
  ).join("");

  document.getElementById("professionalSensitivityTable").innerHTML =
    header+rows+'</tbody></table>';
}

async function sensitivity(){
  if (busySensitivity || calculating) {
    throw new Error("Ya existe un cálculo en curso.");
  }

  if (!result) {
    throw new Error("Calcule primero el escenario base.");
  }

  if (!health.passed) {
    throw new Error("Las pruebas obligatorias no han sido superadas.");
  }

  const base = result;
  const c = clone(base.c);
  const data = base.data?clone(base.data):null;

  const jobs = [
    {label:"Consumo DC −10 %",key:"sec",factor:0.9},
    {label:"Consumo DC +10 %",key:"sec",factor:1.1},
    {label:"CAPEX renovable −10 %",key:"capRenew",factor:0.9},
    {label:"CAPEX renovable +10 %",key:"capRenew",factor:1.1},
    {label:"Tasa de descuento −10 %",key:"rate",factor:0.9},
    {label:"Tasa de descuento +10 %",key:"rate",factor:1.1}
  ];

  const rows = [{
    label:"Base",
    lcoh:base.netLcoh,
    delta:0,
    npv:base.npv,
    error:null
  }];

  busySensitivity = true;
  const control = document.getElementById("professionalSensitivity");
  control.disabled = true;

  try {
    for (let index=0;index<jobs.length;index++){
      const job = jobs[index];

      document.getElementById("professionalSensitivityStatus").textContent =
        "Evaluando "+(index+1)+"/"+jobs.length+": "+job.label;

      await new Promise(resolve=>setTimeout(resolve,20));

      const alternative = Object.assign({},c);
      alternative[job.key] = c[job.key]*job.factor;

      try {
        const evaluated = calculate(alternative,data);

        rows.push({
          label:job.label,
          lcoh:evaluated.netLcoh,
          delta:evaluated.netLcoh-base.netLcoh,
          npv:evaluated.npv,
          error:null
        });
      } catch(error) {
        rows.push({
          label:job.label,
          lcoh:null,
          delta:null,
          npv:null,
          error:error.message || String(error)
        });
      }
    }

    const output = {
      baseCalculatedAt:base.created,
      method:"Motor completo; variaciones univariantes relativas de ±10 %",
      evaluatedAt:new Date().toISOString(),
      rows:rows
    };

    /*
     * No publicar una sensibilidad perteneciente a un resultado antiguo.
     */
    if (result !== base) {
      throw new Error(
        "El resultado base cambió durante la evaluación. Se descarta la sensibilidad."
      );
    }

    sensitivityOutput = output;
    renderSensitivity(output);

    const failures = rows.filter(row=>row.error).length;

    document.getElementById("professionalSensitivityStatus").textContent =
      failures
      ? "Evaluación terminada con "+failures+" alternativas no calculables."
      : "Evaluación terminada. No implica probabilidad ni optimalidad.";

    status("Sensibilidad calculada sin modificar el proyecto.");
  } finally {
    busySensitivity = false;
    control.disabled = false;
  }
}

function bindActions(){
  document.getElementById("professionalTests").addEventListener(
    "click",
    guard(function(){
      if (calculating || busySensitivity) {
        throw new Error("Espere a que termine el cálculo.");
      }

      const checked = executeTests();

      if (!checked.passed) {
        result = null;
        status("Motor bloqueado por fallo de comprobaciones.",true);
      } else {
        status("Comprobaciones obligatorias superadas.");
      }
    })
  );

  document.getElementById("professionalAudit").addEventListener(
    "click",guard(exportAudit)
  );

  document.getElementById("professionalSensitivity").addEventListener(
    "click",guard(sensitivity)
  );

  /*
   * Evita lanzar el cálculo principal mientras se ejecuta sensibilidad.
   * El manejador de captura actúa antes del manejador del núcleo.
   */
  document.getElementById("form").addEventListener("submit",function(event){
    if (busySensitivity || !health.passed) {
      event.preventDefault();
      event.stopImmediatePropagation();

      status(
        busySensitivity
        ? "Espere a que termine la sensibilidad."
        : "Motor bloqueado: revise las comprobaciones obligatorias.",
        true
      );
    }
  },true);

  /*
   * El núcleo lee el formulario antes de su espera asíncrona.
   * Este manejador posterior bloquea controles durante esa espera.
   * Evita importar o editar escenarios mientras se publica el resultado.
   */
  document.getElementById("form").addEventListener("submit",function(event){
    if (event.defaultPrevented && calculating) {
      const controls = Array.from(
        document.querySelectorAll("main input, main select, main button")
      );

      const original = controls.map(control=>({
        control:control,
        disabled:control.disabled
      }));

      controls.forEach(control=>control.disabled=true);

      const timer = setInterval(function(){
        if (calculating) return;
        clearInterval(timer);

        original.forEach(item=>{
          item.control.disabled=item.disabled;
        });

        const submit = document.querySelector(
          '#form button[type="submit"]'
        );

        if (submit) submit.disabled=false;
      },50);
    }
  });

  /*
   * Evita dejar información de calidad asociada a un resultado invalidado.
   */
  function clearDerived(){
    sensitivityOutput = null;
    document.getElementById("professionalSensitivityTable").innerHTML = "";
    document.getElementById("professionalSensitivityStatus").textContent =
      "Hay cambios pendientes: recalcule el escenario base.";
    document.getElementById("professionalWarnings").innerHTML = "";
  }

  document.getElementById("form").addEventListener("input",clearDerived);
  document.getElementById("form").addEventListener("change",clearDerived);
}

makePanel();
bindActions();
executeTests();

if (health.passed) {
  status(
    "Versión 3.1 preparada. Comprobaciones obligatorias superadas; introduzca datos y calcule."
  );
} else {
  status(
    "Versión 3.1 bloqueada: revise Calidad y trazabilidad.",
    true
  );
}

if (location.hash==="#calidad") {
  selectTab("calidad");
}

})();
