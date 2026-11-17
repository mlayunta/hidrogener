(function () {
"use strict";

const RELEASE = "3.2";
const ENGINE = "h2verde-temporal-dc-3.2";
const HOUR_MS = 3600000;

const originalValidateConfig = validateConfig;
const originalCalculate = calculate;
const originalRenderResults = renderResults;
const originalSynthetic = synthetic;

let health = {passed:false, executedAt:null, cases:[]};
let busy = false;
let sensitivityOutput = null;
let selectedCurve = null;

const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) {
  throw new Error(message);
}

function near(actual, expected, label, tolerance) {
  const limit = tolerance === undefined
    ? 1e-8 * Math.max(1, Math.abs(expected))
    : tolerance;

  if (!finite(actual) || Math.abs(actual - expected) > limit) {
    fail(label + ": esperado " + expected + ", obtenido " + actual);
  }
}

function text(value, label, maximum = 2000) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum
  ) {
    fail(label + ": texto obligatorio o demasiado largo.");
  }
  return value.trim();
}

function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "number") {
    return finite(value) ? JSON.stringify(value) : "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonical).join(",") + "]";
  }
  if (typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonical(value[key])
    ).join(",") + "}";
  }
  fail("Dato no serializable.");
}

async function sha256(value) {
  if (!globalThis.crypto || !crypto.subtle) return null;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(hash), b =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/* Fechas estrictas: no aceptar la normalización silenciosa de Date.parse. */
function parseInstant(value) {
  if (typeof value !== "string") fail("Fecha no textual.");

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/
  );

  if (!match) {
    fail(
      "Fecha inválida: use ISO 8601 con segundos y zona, " +
      "por ejemplo 2024-01-01T00:00:00Z."
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (year < 1900 || year > 2200) fail("Año fuera de [1900,2200].");

  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(local);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    fail("Fecha inexistente: " + value);
  }

  let offset = 0;

  if (match[7] !== "Z") {
    const offsetHours = Number(match[7].slice(1, 3));
    const offsetMinutes = Number(match[7].slice(4, 6));

    if (
      offsetHours > 14 ||
      offsetMinutes > 59 ||
      (offsetHours === 14 && offsetMinutes !== 0)
    ) {
      fail("Desfase horario inválido.");
    }

    offset = (offsetHours * 60 + offsetMinutes) *
      (match[7][0] === "+" ? 1 : -1);
  }

  return local - offset * 60000;
}

function validateTimeline(values) {
  if (!Array.isArray(values)) fail("Fechas: se requiere un array.");

  const instants = values.map(parseInstant);
  if (!instants.length) fail("Serie temporal vacía.");

  const first = new Date(instants[0]);
  const year = first.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const expected = (end - start) / HOUR_MS;

  if (instants[0] !== start) {
    fail("La serie debe comenzar el 1 de enero a las 00:00 UTC.");
  }

  if (instants.length !== expected) {
    fail(
      "El año UTC " + year + " requiere " + expected +
      " intervalos horarios; se han recibido " + instants.length + "."
    );
  }

  for (let i = 0; i < instants.length; i++) {
    if (instants[i] !== start + i * HOUR_MS) {
      fail(
        "Fecha duplicada, hueco, desorden o intervalo no horario en fila " +
        (i + 2) + "."
      );
    }
  }

  return {
    timestamps:instants.map(t => new Date(t).toISOString()),
    year:year,
    intervals:expected,
    start:new Date(start).toISOString(),
    endExclusive:new Date(end).toISOString()
  };
}

/*
 * Curva DC por fracción de potencia nominal.
 * Se exige producción creciente para poder resolver el despacho.
 */
function validateCurve(value) {
  if (value === null || value === undefined) return null;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Curva inválida.");
  }

  if (value.schema !== "h2verde-curve-dc-1") {
    fail("Formato de curva no reconocido.");
  }

  if (value.perimeter !== "stack_dc") {
    fail(
      "Esta versión solo admite stack_dc. " +
      "Una curva AC de sistema necesita otro perímetro de balance."
    );
  }

  const nominal = value.nominalKw;
  if (!finite(nominal) || nominal <= 0 || nominal > 10000000) {
    fail("Potencia nominal de la curva inválida.");
  }

  if (
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length > 200
  ) {
    fail("La curva necesita entre 2 y 200 puntos.");
  }

  const points = value.points.map((p, i) => {
    if (
      !p || !finite(p.load) || !finite(p.secKwhKg) ||
      p.load <= 0 || p.load > 1 ||
      p.secKwhKg < 33.33 || p.secKwhKg > 200
    ) {
      fail("Punto de curva inválido: " + (i + 1));
    }
    return {load:p.load, secKwhKg:p.secKwhKg};
  });

  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1];
    const right = points[i];

    if (right.load <= left.load) {
      fail("Las cargas de la curva deben estar ordenadas y sin duplicados.");
    }

    /*
     * Si SEC = a + b·carga, producción proporcional a carga/SEC.
     * a > 0 garantiza producción estrictamente creciente en el segmento.
     */
    const slope = (right.secKwhKg - left.secKwhKg) /
      (right.load - left.load);
    const intercept = left.secKwhKg - slope * left.load;

    if (intercept <= 0) {
      fail("La curva implica producción no creciente en un segmento.");
    }
  }

  if (Math.abs(points[points.length - 1].load - 1) > 1e-12) {
    fail("La curva debe incluir un punto a carga nominal 1.");
  }

  return {
    schema:"h2verde-curve-dc-1",
    perimeter:"stack_dc",
    equipment:text(value.equipment, "Equipo", 300),
    technology:text(value.technology, "Tecnología", 100),
    nominalKw:nominal,
    source:text(value.source, "Referencia documental"),
    sourceDate:text(value.sourceDate, "Fecha o edición de la fuente", 100),
    conditions:text(value.conditions, "Condiciones y límites"),
    verification:"Referencia declarada por el usuario; no verificada automáticamente",
    points:points
  };
}

function curveSEC(curve, load) {
  const points = curve.points;

  if (
    load < points[0].load - 1e-12 ||
    load > points[points.length - 1].load + 1e-12
  ) {
    fail("Carga fuera de la curva: no se permite extrapolación.");
  }

  for (let i = 1; i < points.length; i++) {
    if (load <= points[i].load + 1e-12) {
      const a = points[i - 1];
      const b = points[i];
      const fraction = (load - a.load) / (b.load - a.load);
      return a.secKwhKg + fraction * (b.secKwhKg - a.secKwhKg);
    }
  }

  return points[points.length - 1].secKwhKg;
}

/* Serie antigua, calendario real o contenedor de curva sin series. */
validateSeries = function (data) {
  if (data === null || data === undefined) return null;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("Series inválidas.");
  }

  const output = {
    name:typeof data.name === "string"
      ? data.name.slice(0, 200)
      : "Datos importados",
    curve:validateCurve(data.curve)
  };

  let count = 0;
  let length = 8760;

  if (data.timestamps !== undefined) {
    const timeline = validateTimeline(data.timestamps);
    output.timestamps = timeline.timestamps;
    length = timeline.intervals;
  }

  output.sources = {};

  for (const key of ["solar", "wind", "prices"]) {
    if (data[key] === null || data[key] === undefined) continue;

    if (!Array.isArray(data[key]) || data[key].length !== length) {
      fail(key + ": se requieren " + length + " valores.");
    }

    output[key] = data[key].map((v, i) => {
      if (!finite(v) || typeof v !== "number") {
        fail(key + ": valor inválido en intervalo " + i);
      }

      if (key !== "prices" && (v < 0 || v > 1)) {
        fail(key + ": factor fuera de [0,1].");
      }

      if (key === "prices" && (v < -1000 || v > 10000)) {
        fail("Precio fuera del rango permitido.");
      }

      return v;
    });

    output.sources[key] =
      typeof data.sources?.[key] === "string"
        ? data.sources[key].slice(0, 2000)
        : output.name;

    count++;
  }

  if (!count && !output.curve) fail("No hay series ni curva reconocidas.");

  if (output.timestamps && !count) {
    fail("Un calendario necesita al menos una serie asociada.");
  }

  return output;
};

function makeSynthetic(c, n, year) {
  if (n === 8760 && year === null) return originalSynthetic(c);

  const solar = new Float64Array(n);
  const wind = new Float64Array(n);
  const lat = c.lat * Math.PI / 180;
  const days = n / 24;

  for (let h = 0; h < n; h++) {
    const day = Math.floor(h / 24);
    const hour = h % 24 + 0.5;
    const seasonalDay = day * 365 / days;
    const dec = 23.45 * Math.PI / 180 *
      Math.sin(2 * Math.PI * (284 + seasonalDay) / 365);
    const angle = (hour - 12) * Math.PI / 12;
    const altitude =
      Math.sin(lat) * Math.sin(dec) +
      Math.cos(lat) * Math.cos(dec) * Math.cos(angle);
    const weather = 0.65 + 0.35 *
      (0.5 + 0.5 * Math.sin(day * 1.73 + Math.sin(day * 0.17)));

    solar[h] = Math.max(0, altitude) * weather;
    wind[h] = 0.12 + 0.88 *
      (0.5 + 0.5 * Math.sin(h * 0.031 + Math.sin(h * 0.002) * 2));
  }

  return {
    solar:normalizeProfile(solar, c.solarCF / 100),
    wind:normalizeProfile(wind, c.windCF / 100)
  };
}

getProfiles = function (c, data) {
  const timeline = data?.timestamps
    ? validateTimeline(data.timestamps)
    : null;
  const n = timeline ? timeline.intervals : 8760;

  /*
   * No generar columnas sintéticas innecesarias.
   * Evita rechazar un factor sintético imposible cuando la serie es medida.
   */
  const needSolar = !data?.solar && c.pv > 0;
  const needWind = !data?.wind && c.wind > 0;

  const fallbackConfig = Object.assign({}, c, {
    solarCF:needSolar ? c.solarCF : 0,
    windCF:needWind ? c.windCF : 0
  });

  const fallback = (needSolar || needWind)
    ? makeSynthetic(fallbackConfig, n, timeline ? timeline.year : null)
    : {solar:new Float64Array(n), wind:new Float64Array(n)};

  return {
    solar:data?.solar ? Float64Array.from(data.solar) : fallback.solar,
    wind:data?.wind ? Float64Array.from(data.wind) : fallback.wind,
    prices:data?.prices
      ? Float64Array.from(data.prices)
      : new Float64Array(n).fill(c.gridPrice),
    timestamps:timeline ? timeline.timestamps.slice() : null,
    calendar:timeline,
    curve:data?.curve ? validateCurve(data.curve) : null,
    description:timeline
      ? "Año UTC " + timeline.year + ": " + n +
        " intervalos. Año de referencia repetido durante la vida económica."
      : "Año normalizado de 8.760 posiciones sin fechas reales; " +
        "repetido durante la vida económica."
  };
};

/* Despacho DC no lineal con curva documentada. */
annualSimulation = function (c, profiles, initialAge, initialSOC, keepHours) {
  const n = profiles.solar.length;
  const curve = profiles.curve;
  const inv = c.inv / 100;
  const rect = c.rect / 100;
  const bop = c.bop / 100;
  const eta = Math.sqrt(c.batEff / 100);

  if (curve && Math.abs(curve.nominalKw - c.stack) > 1e-6) {
    fail(
      "La potencia DC del formulario debe coincidir con nominalKw de la curva. " +
      "No se escala un equipo automáticamente."
    );
  }

  const minimumLoad = Math.max(
    c.minimum / 100,
    curve ? curve.points[0].load : 0
  );

  const capacity = c.battery
    ? c.batCap * 1000 * (c.socMax - c.socMin) / 100
    : 0;
  const batteryPower = c.battery ? c.batPower * 1000 : 0;

  const compSpecific = compression(c);
  const waterSpecific = c.water / 1000 * c.waterEnergy;
  const oxygenSpecific = O2_RATIO * c.o2Capture / 100 * c.o2Energy;
  const extraSpecific = compSpecific + waterSpecific + oxygenSpecific;

  let age = initialAge;
  let soc = initialSOC;

  const a = {
    renewable:0, grid:0, renewUsed:0, invLoss:0, curt:0,
    rectLoss:0, bop:0, stack:0, comp:0, waterEnergy:0,
    o2Energy:0, batteryLoss:0, kg:0, replacements:0,
    operating:0, priceCost:0, renewCost:0, emissionsG:0,
    charged:0, discharged:0, socInitial:initialSOC,
    months:new Array(12).fill(0)
  };

  const H = keepHours ? Object.fromEntries(
    ["renewable", "stack", "kg", "grid", "plant", "soc",
     "charge", "discharge", "sec"].map(key => [key, new Float64Array(n)])
  ) : null;

  const normalEnds = [
    744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016,8760
  ];

  let normalMonth = 0;

  for (let h = 0; h < n; h++) {
    if (age >= c.stackLife) {
      age = 0;
      a.replacements++;
    }

    const degradation = 1 + c.deg / 100 * age / 1000;

    function operation(load) {
      if (load <= 0) return {stack:0, kg:0, plant:0, sec:0};

      const specific = (curve ? curveSEC(curve, load) : c.sec) *
        degradation;
      const stack = c.stack * load;
      const kg = stack / specific;
      const plant = stack * (1 + bop) / rect + kg * extraSpecific;

      return {stack:stack, kg:kg, plant:plant, sec:specific};
    }

    const raw = profiles.solar[h] * c.pv + profiles.wind[h] * c.wind;
    const renewableAC = raw * inv;
    const availableDischarge = Math.min(batteryPower, soc * eta);
    const available = renewableAC + availableDischarge;

    const nominal = operation(1);
    const minimum = operation(minimumLoad);
    let op;

    if (c.gridMode === "nominal") {
      op = nominal;
    } else if (available + 1e-9 < minimum.plant) {
      op = c.gridMode === "minimum"
        ? minimum
        : operation(0);
    } else if (available >= nominal.plant) {
      op = nominal;
    } else {
      /*
       * La demanda AC es creciente en el rango validado.
       * Bisección: buscar la carga atendible sin exceder energía.
       */
      let low = minimumLoad;
      let high = 1;

      for (let iteration = 0; iteration < 36; iteration++) {
        const mid = (low + high) / 2;
        if (operation(mid).plant <= available) low = mid;
        else high = mid;
      }

      op = operation(low);
    }

    const discharge = Math.min(
      Math.max(0, op.plant - renewableAC),
      availableDischarge
    );
    const grid = Math.max(0, op.plant - renewableAC - discharge);

    if (c.gridMode === "off" && grid > 1e-7) {
      fail("Importación no permitida en intervalo " + h);
    }

    const charge = Math.min(
      Math.max(0, renewableAC - op.plant),
      batteryPower,
      Math.max(0, capacity - soc) / eta
    );

    const curt = Math.max(0, renewableAC - op.plant - charge);
    const delta = charge * eta - discharge / eta;
    const batteryLoss = charge * (1 - eta) +
      discharge * (1 / eta - 1);

    soc += delta;

    if (soc < -1e-7 || soc > capacity + 1e-7) {
      fail("SOC fuera de límites.");
    }

    soc = Math.max(0, Math.min(capacity, soc));

    const bopEnergy = op.stack * bop;
    const rectLoss = (op.stack + bopEnergy) / rect -
      op.stack - bopEnergy;
    const compEnergy = op.kg * compSpecific;
    const waterEnergy = op.kg * waterSpecific;
    const oxygenEnergy = op.kg * oxygenSpecific;
    const renewableUsed = Math.min(renewableAC, op.plant) + charge;

    const residual = raw + grid -
      (raw - renewableAC + curt + rectLoss + bopEnergy +
       op.stack + compEnergy + waterEnergy + oxygenEnergy +
       batteryLoss + delta);

    if (Math.abs(residual) > 1e-7 * Math.max(1, raw + grid)) {
      fail("No cierra el balance eléctrico en intervalo " + h);
    }

    if (op.stack > 1e-8) {
      age++;
      a.operating++;
    }

    a.renewable += raw;
    a.grid += grid;
    a.renewUsed += renewableUsed;
    a.invLoss += raw - renewableAC;
    a.curt += curt;
    a.rectLoss += rectLoss;
    a.bop += bopEnergy;
    a.stack += op.stack;
    a.comp += compEnergy;
    a.waterEnergy += waterEnergy;
    a.o2Energy += oxygenEnergy;
    a.batteryLoss += batteryLoss;
    a.kg += op.kg;
    a.charged += charge;
    a.discharged += discharge;
    a.priceCost += grid * profiles.prices[h] / 1000;
    a.renewCost += renewableUsed * c.renewPrice / 1000;
    a.emissionsG += grid * c.gridCI + renewableUsed * c.renewCI;

    let month;

    if (profiles.timestamps) {
      month = new Date(profiles.timestamps[h]).getUTCMonth();
    } else {
      while (h >= normalEnds[normalMonth]) normalMonth++;
      month = normalMonth;
    }

    a.months[month] += op.kg;

    if (H) {
      H.renewable[h] = raw;
      H.stack[h] = op.stack;
      H.kg[h] = op.kg;
      H.grid[h] = grid;
      H.plant[h] = op.plant;
      H.soc[h] = c.battery
        ? c.socMin + soc / (c.batCap * 1000) * 100
        : 0;
      H.charge[h] = charge;
      H.discharge[h] = discharge;
      H.sec[h] = op.sec;
    }
  }

  a.socFinal = soc;
  a.ageFinal = age;
  a.deltaSOC = soc - initialSOC;
  a.delivered = a.kg * (1 - c.loss / 100);
  a.useful = a.delivered * LHV * c.endEff / 100;
  a.waterM3 = a.kg * c.water / 1000;
  a.o2Produced = a.kg * O2_RATIO;
  a.o2Sold = a.o2Produced * c.o2Capture / 100;
  a.emissionsG += a.kg * c.otherCI * 1000;
  a.ci = a.delivered > 0
    ? a.emissionsG / (a.delivered * LHV * 3.6)
    : NaN;

  a.residual = a.renewable + a.grid -
    (a.invLoss + a.curt + a.rectLoss + a.bop + a.stack +
     a.comp + a.waterEnergy + a.o2Energy +
     a.batteryLoss + a.deltaSOC);

  if (
    Math.abs(a.residual) >
    1e-7 * Math.max(1, a.renewable + a.grid)
  ) {
    fail("No cierra el balance anual.");
  }

  a.H = H;
  return a;
};

function bundle(data, curve) {
  const value = data ? copy(data) : null;

  if (value) {
    value.curve = curve ? copy(curve) : null;
    return validateSeries(value);
  }

  return curve
    ? validateSeries({name:"Curva con recurso sintético", curve:curve})
    : null;
}

function warningList(r) {
  const output = [
    "Modelo de prefactibilidad; sin validación experimental independiente.",
    "Compresión isotérmica de gas ideal; no representa un compresor real.",
    "No se modelan arranques ni indisponibilidad durante reposiciones.",
    "Las emisiones son parciales; no acreditan RFNBO.",
    "El año de referencia se repite; no es una predicción meteorológica plurianual."
  ];

  if (!r.profiles.timestamps) {
    output.push(
      "Series sin fechas reales: no se acredita coincidencia temporal con datos externos."
    );
  }

  if (r.profiles.curve) {
    output.push(
      "Curva DC de referencia declarada por el usuario; " +
      "la aplicación no verifica automáticamente la autenticidad de la fuente."
    );
    output.push(
      "La degradación multiplica el consumo de la curva; esa ley necesita calibración."
    );
  } else {
    output.push("Consumo DC constante declarado, sin curva documentada.");
  }

  if (r.c.battery) {
    output.push(
      "Batería por reglas, sin optimalidad ni envejecimiento físico de capacidad."
    );
  }

  if (r.c.pv > 0 && !r.data?.solar) {
    output.push("Recurso solar sintético.");
  }

  if (r.c.wind > 0 && !r.data?.wind) {
    output.push("Recurso eólico sintético.");
  }

  if (r.c.o2Capture > 0) {
    output.push(
      "Los créditos por O₂ requieren comprador y costes de entrega justificados."
    );
  }

  return output;
}

calculate = function (c, data) {
  if (!health.passed) fail("Motor bloqueado: fallan pruebas obligatorias.");

  const r = originalCalculate(c, data);
  r.professional = {
    engine:ENGINE,
    release:RELEASE,
    calculatedAt:r.created,
    calendar:r.profiles.calendar,
    intervals:r.profiles.solar.length,
    intervalHours:1,
    repetition:"Se repite el año de referencia en todos los años económicos.",
    curve:r.profiles.curve,
    sources:r.data?.sources || {},
    tests:copy(health),
    warnings:warningList(r)
  };
  return r;
};

/* CSV estricto, una fila por intervalo. */
function csvCells(line) {
  const cells = [];
  let token = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        token += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ";" && !quoted) {
      cells.push(token.trim());
      token = "";
    } else {
      token += ch;
    }
  }

  if (quoted) fail("Comillas CSV sin cerrar.");
  cells.push(token.trim());
  return cells;
}

function numeric(token, label) {
  const normalized = token.replace(",", ".");

  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)
  ) {
    fail("Número inválido: " + label);
  }

  return Number(normalized);
}

function mergeSeries(existing, next) {
  if (!existing) return next;

  const previous = validateSeries(existing);

  if (previous.timestamps && next.timestamps) {
    if (
      previous.timestamps.length !== next.timestamps.length ||
      previous.timestamps.some((t, i) => t !== next.timestamps[i])
    ) {
      fail(
        "Los archivos no tienen el mismo calendario UTC. " +
        "No se emparejan por posición ni se rellenan huecos."
      );
    }

    const merged = copy(previous);

    for (const key of ["solar", "wind", "prices"]) {
      if (next[key]) {
        merged[key] = next[key].slice();
        merged.sources[key] = next.sources[key];
      }
    }

    merged.name = "Series combinadas por instante UTC";
    return validateSeries(merged);
  }

  /*
   * Las importaciones sin calendario no pueden fusionarse
   * con garantías temporales. Sustituyen las series anteriores.
   */
  return next;
}

parseCSV = function (value) {
  if (value.length > 10 * 1024 * 1024) fail("CSV demasiado grande.");

  const lines = value.replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n").split("\n");

  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  if (lines.length < 2) fail("CSV vacío.");

  const headers = csvCells(lines[0]).map(v => v.toLowerCase());
  const allowed = ["fecha_utc", "hora", "solar", "eolica", "precio_eur_mwh"];

  if (
    new Set(headers).size !== headers.length ||
    headers.some(h => !allowed.includes(h))
  ) {
    fail("Cabeceras desconocidas o duplicadas.");
  }

  const dated = headers.includes("fecha_utc");
  const indexed = headers.includes("hora");

  if (dated === indexed) {
    fail("Use fecha_utc o hora, pero no ambas.");
  }

  const source = $("temporalSource").value.trim();

  if (!source) fail("Indique la procedencia documental del CSV.");

  const output = {
    name:source.slice(0, 200),
    sources:{},
    curve:selectedCurve
  };

  if (dated) output.timestamps = [];

  const mapping = {
    solar:"solar",
    eolica:"wind",
    precio_eur_mwh:"prices"
  };

  for (const [column, key] of Object.entries(mapping)) {
    if (headers.includes(column)) {
      output[key] = [];
      output.sources[key] = source;
    }
  }

  if (!Object.keys(mapping).some(column => headers.includes(column))) {
    fail("Incluya al menos una columna de recurso o precio.");
  }

  for (let i = 1; i < lines.length; i++) {
    const row = csvCells(lines[i]);

    if (row.length !== headers.length) {
      fail("Número de columnas incorrecto en fila " + (i + 1));
    }

    if (dated) {
      const instant = parseInstant(row[headers.indexOf("fecha_utc")]);
      output.timestamps.push(new Date(instant).toISOString());
    } else {
      const hour = row[headers.indexOf("hora")];
      if (!/^\d+$/.test(hour) || Number(hour) !== i - 1) {
        fail("Índice incorrecto en fila " + (i + 1));
      }
    }

    for (const [column, key] of Object.entries(mapping)) {
      if (output[key]) {
        output[key].push(
          numeric(row[headers.indexOf(column)], column + ", fila " + (i + 1))
        );
      }
    }
  }

  return mergeSeries(imported, validateSeries(output));
};

projectPayload = function () {
  return {
    app:"H2-Verde-Consolidado",
    version:RELEASE,
    config:readForm(),
    series:bundle(imported, selectedCurve),
    saved:new Date().toISOString()
  };
};

acceptProject = function (p) {
  if (
    !p || p.app !== "H2-Verde-Consolidado" ||
    !["3.0", "3.1", RELEASE].includes(p.version)
  ) {
    fail("Proyecto incompatible: formatos admitidos 3.0, 3.1 y 3.2.");
  }

  const nextConfig = originalValidateConfig(p.config);
  const nextSeries = validateSeries(p.series);

  config = nextConfig;
  imported = nextSeries;
  selectedCurve = nextSeries?.curve || null;

  renderForm();
  renderSeriesInfo();
  invalidate();
  clearProfessional();
};

renderSeriesInfo = function () {
  const columns = imported
    ? ["solar", "wind", "prices"].filter(key => imported[key])
    : [];

  const timeline = imported?.timestamps
    ? validateTimeline(imported.timestamps)
    : null;

  $("seriesInfo").textContent =
    "Columnas importadas: " + (columns.join(", ") || "ninguna") +
    ". Calendario: " + (
      timeline
      ? timeline.year + " UTC, " + timeline.intervals + " horas."
      : "8.760 posiciones sin fechas."
    );

  if ($("curveInfo")) {
    $("curveInfo").textContent = selectedCurve
      ? selectedCurve.equipment + " · " +
        selectedCurve.points.length + " puntos · " +
        selectedCurve.nominalKw + " kW DC · fuente declarada: " +
        selectedCurve.source
      : "Sin curva: consumo DC constante del formulario.";
  }
};

function clearProfessional() {
  sensitivityOutput = null;
  if ($("professionalWarnings")) $("professionalWarnings").innerHTML = "";
  if ($("professionalSensitivityTable")) {
    $("professionalSensitivityTable").innerHTML = "";
  }
}

const originalInvalidate = invalidate;
invalidate = function () {
  originalInvalidate();
  clearProfessional();
};

renderResults = function (r) {
  originalRenderResults(r);
  clearProfessional();

  const provenance = r.professional;
  const warnings = provenance.warnings;

  $("professionalWarnings").innerHTML =
    "<ul>" + warnings.map(w =>
      "<li>" + escapeHTML(w) + "</li>"
    ).join("") + "</ul>";

  const originalAudit = JSON.parse($("audit").textContent);
  originalAudit.version = RELEASE;
  originalAudit.convenciones.intervalos = r.profiles.solar.length;
  originalAudit.temporalYEquipo = provenance;
  $("audit").textContent = JSON.stringify(originalAudit, null, 2);

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML =
    "<h2>Calendario y equipo · versión " + RELEASE + "</h2>" +
    "<p>" + escapeHTML(r.profiles.description) + "</p>" +
    "<p>" + escapeHTML(
      r.profiles.curve
      ? "Equipo: " + r.profiles.curve.equipment +
        ". Fuente declarada: " + r.profiles.curve.source
      : "Consumo DC constante."
    ) + "</p>" +
    "<ul>" + warnings.map(w =>
      "<li>" + escapeHTML(w) + "</li>"
    ).join("") + "</ul>" +
    "<pre>" + escapeHTML(JSON.stringify(provenance, null, 2)) + "</pre>";

  $("report").appendChild(card);
};

function replaceButton(id, callback) {
  const old = $(id);
  const next = old.cloneNode(true);
  old.replaceWith(next);
  next.addEventListener("click", guard(callback));
}

function addInterface() {
  const header = document.querySelector("header p");
  header.textContent =
    "Miguel Ángel Layunta López · Motor temporal DC · versión " + RELEASE;

  const profileCard = $("panel-perfiles").querySelector(".card");

  profileCard.querySelector("h2").textContent =
    "Series horarias con calendario UTC";

  const paragraphs = profileCard.querySelectorAll("p");
  for (const p of paragraphs) p.hidden = true;

  const example = profileCard.querySelector("pre");
  example.textContent =
    "fecha_utc;solar;eolica;precio_eur_mwh\n" +
    "2024-01-01T00:00:00Z;0;0,35;62\n" +
    "2024-01-01T01:00:00Z;0;0,28;58";

  const instructions = document.createElement("div");
  instructions.innerHTML =
    "<p>CSV de un año UTC completo: 8.760 o 8.784 intervalos de una hora. " +
    "La fecha identifica el comienzo del intervalo. Use fecha_utc con " +
    "ISO 8601 y zona explícita. Se normaliza a UTC.</p>" +
    "<p>Las columnas solar y eolica son factores [0,1] antes del " +
    "convertidor. precio_eur_mwh tiene unidades €/MWh.</p>" +
    "<p>Archivos separados se combinan únicamente si todos sus instantes " +
    "UTC coinciden. Una columna nueva reemplaza la anterior de esa variable. " +
    "No se rellenan huecos.</p>" +
    "<p>Se conserva hora de 0 a 8759 para proyectos antiguos, " +
    "pero esos archivos no tienen alineación temporal acreditada.</p>" +
    '<label>Procedencia del siguiente CSV' +
    '<input id="temporalSource" maxlength="2000" ' +
    'placeholder="Proveedor, documento o URL, fecha y transformación aplicada"></label>' +
    "<p>Las fechas UTC representan intervalos medios. Los recursos sintéticos " +
    "no están geolocalizados temporalmente por longitud y no deben usarse " +
    "para demostrar coincidencia renovable.</p>";

  profileCard.insertBefore(instructions, example);

  const equipment = document.createElement("div");
  equipment.className = "card";
  equipment.innerHTML =
    "<h2>Curva documentada del stack DC</h2>" +
    "<p>Importe JSON con puntos de carga y consumo DC. " +
    "No se extrapola ni se escala la potencia nominal. " +
    "La carga mínima efectiva es el máximo entre el formulario " +
    "y la primera carga documentada.</p>" +
    '<div class="toolbar">' +
    '<button id="curveImport" type="button">Importar curva JSON</button>' +
    '<button id="curveExport" type="button">Exportar curva</button>' +
    '<button id="curveClear" type="button">Usar consumo constante</button>' +
    "</div>" +
    '<input id="curveFile" type="file" accept=".json,application/json" hidden>' +
    '<p id="curveInfo"></p>' +
    "<p>La fuente y las condiciones son declaraciones auditables, " +
    "no una verificación automática de fabricante.</p>";

  $("panel-perfiles").appendChild(equipment);

  const navButton = document.createElement("button");
  navButton.type = "button";
  navButton.dataset.tab = "calidad";
  navButton.setAttribute("role", "tab");
  navButton.setAttribute("aria-selected", "false");
  navButton.tabIndex = -1;
  navButton.textContent = "Calidad y trazabilidad";
  document.querySelector("nav").appendChild(navButton);

  const quality = document.createElement("section");
  quality.id = "panel-calidad";
  quality.className = "panel";
  quality.hidden = true;
  quality.innerHTML =
    '<div class="card"><h2>Pruebas obligatorias</h2>' +
    '<div id="professionalHealth"></div>' +
    '<div id="professionalCases" class="scroll"></div>' +
    '<div class="toolbar">' +
    '<button id="professionalTests" type="button">Repetir pruebas</button>' +
    '<button id="professionalAudit" type="button">Exportar expediente</button>' +
    "</div></div>" +
    '<div class="card"><h2>Sensibilidad con el motor completo</h2>' +
    "<p>Variaciones univariantes de ±10 %. Con curva activa se varían " +
    "sus consumos, no el campo constante inactivo.</p>" +
    '<button id="professionalSensitivity" type="button">Evaluar sensibilidad</button>' +
    '<p id="professionalSensitivityStatus"></p>' +
    '<div id="professionalSensitivityTable" class="scroll"></div></div>' +
    '<div class="card"><h2>Límites del resultado</h2>' +
    '<div id="professionalWarnings"></div>' +
    "<p>Pruebas de software, no certificación ni validación de una planta.</p></div>";

  document.querySelector("main").appendChild(quality);

  replaceButton("exportSeries", function () {
    const p = getProfiles(readForm(), bundle(imported, selectedCurve));
    const rows = [[
      p.timestamps ? "fecha_utc" : "hora",
      "solar", "eolica", "precio_eur_mwh"
    ]];

    for (let i = 0; i < p.solar.length; i++) {
      rows.push([
        p.timestamps ? p.timestamps[i] : i,
        p.solar[i], p.wind[i], p.prices[i]
      ]);
    }

    csvDownload("h2verde-series-3.2.csv", rows);
  });

  replaceButton("hourlyCsv", function () {
    const r = requireResult();
    const p = r.profiles;
    const H = r.rows[0].a.H;
    const rows = [[
      p.timestamps ? "fecha_utc" : "hora",
      "renovable_kW", "stack_DC_kW", "H2_kg",
      "red_kW", "planta_kW", "SOC_pct",
      "carga_kW", "descarga_kW", "consumo_DC_kWh_kg"
    ]];

    for (let i = 0; i < p.solar.length; i++) {
      rows.push([
        p.timestamps ? p.timestamps[i] : i,
        H.renewable[i], H.stack[i], H.kg[i],
        H.grid[i], H.plant[i], H.soc[i],
        H.charge[i], H.discharge[i], H.sec[i]
      ]);
    }

    csvDownload("h2verde-primer-ano-3.2.csv", rows);
  });

  replaceButton("clearSeries", function () {
    imported = null;
    renderSeriesInfo();
    invalidate();
  });

  replaceButton("defaults", function () {
    if (!confirm("¿Crear un proyecto nuevo y descartar cambios no guardados?")) return;
    config = Object.assign({}, DEFAULTS);
    imported = null;
    selectedCurve = null;
    currentProjectId = null;
    renderForm();
    renderSeriesInfo();
    invalidate();
  });

  $("curveImport").addEventListener("click", () => $("curveFile").click());

  $("curveFile").addEventListener("change", guard(async function () {
    const file = this.files[0];
    this.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) fail("Curva superior a 1 MB.");

    const next = validateCurve(JSON.parse(await file.text()));

    selectedCurve = next;
    if (imported) imported.curve = copy(next);
    renderSeriesInfo();
    invalidate();
    status("Curva importada. Compruebe potencia, fuente y condiciones.");
  }));

  $("curveClear").addEventListener("click", function () {
    selectedCurve = null;
    if (imported) {
      imported.curve = null;
      if (!["solar", "wind", "prices"].some(k => imported[k])) imported = null;
    }
    renderSeriesInfo();
    invalidate();
  });

  $("curveExport").addEventListener("click", guard(function () {
    if (!selectedCurve) fail("No hay curva importada.");
    download(
      "h2verde-curva-dc.json",
      JSON.stringify(selectedCurve, null, 2),
      "application/json"
    );
  }));
}

function analyticConfig() {
  return Object.assign({}, DEFAULTS, {
    years:1, pv:100, wind:0, inv:100, rect:100, bop:0,
    stack:100, sec:50, minimum:0, deg:0, stackLife:100000,
    replacement:0, pIn:1, pOut:1, waterEnergy:0,
    waterPrice:0, o2Capture:0, o2Energy:0, o2Cost:0,
    gridMode:"off", battery:false, capRenew:1000,
    capStack:0, capPlant:0, fixed:0, renewPrice:0,
    rate:0, inflation:0, elecEsc:0, h2Price:1,
    loss:0, otherCI:0, renewCI:0, gridCI:0
  });
}

function annualDates(year) {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return Array.from(
    {length:(end - start) / HOUR_MS},
    (_, i) => new Date(start + i * HOUR_MS).toISOString()
  );
}

function testCurve() {
  return {
    schema:"h2verde-curve-dc-1",
    perimeter:"stack_dc",
    equipment:"Caso analítico, no equipo comercial",
    technology:"Prueba",
    nominalKw:100,
    source:"Definición matemática de prueba",
    sourceDate:"3.2",
    conditions:"Sin auxiliares ni degradación",
    points:[
      {load:0.25, secKwhKg:60},
      {load:1, secKwhKg:50}
    ]
  };
}

function executeTests() {
  const cases = [];

  function test(name, callback) {
    try {
      callback();
      cases.push({name:name, passed:true, detail:"Valor esperado alcanzado"});
    } catch (e) {
      cases.push({name:name, passed:false, detail:e.message});
    }
  }

  function mustReject(callback) {
    let rejected = false;
    try { callback(); } catch (_) { rejected = true; }
    if (!rejected) fail("Se esperaba rechazo.");
  }

  const c = analyticConfig();
  const d = {name:"Prueba", solar:new Array(8760).fill(1)};

  test("Producción analítica y CAPEX único", () => {
    const r = originalCalculate(c, d);
    near(r.rows[0].a.stack, 876000, "Energía");
    near(r.rows[0].a.kg, 17520, "Producción");
    near(r.npvCosts, 1000, "CAPEX");
    near(r.npv, 16520, "VAN");
  });

  test("Descuento de dos años", () => {
    const r = originalCalculate(Object.assign({}, c, {years:2, rate:10}), d);
    near(r.npvKg, 17520 / 1.1 + 17520 / 1.21, "Producción descontada");
  });

  test("Producción nula sin recurso", () => {
    const r = originalCalculate(c, {name:"Cero", solar:new Array(8760).fill(0)});
    near(r.rows[0].a.kg, 0, "Producción");
    if (finite(r.netLcoh)) fail("LCOH debe quedar no definido.");
  });

  test("Coste de red y emisiones en MJ", () => {
    const r = originalCalculate(
      Object.assign({}, c, {pv:0, gridMode:"nominal", gridPrice:100, gridCI:100}),
      null
    );
    near(r.rows[0].electricity, 87600, "Electricidad");
    near(r.rows[0].a.ci, 100 * 50 / (LHV * 3.6), "Emisiones");
  });

  test("Oxígeno calculado sobre H₂ producido", () => {
    const r = originalCalculate(
      Object.assign({}, c, {loss:20, o2Capture:50, o2Price:80}), d
    );
    near(r.rows[0].a.o2Produced, 17520 * O2_RATIO, "Oxígeno");
    near(r.rows[0].oxygenRevenue, 17520 * O2_RATIO * 0.5 / 1000 * 80, "Ingreso");
  });

  test("Reposición física y económica", () => {
    const r = originalCalculate(
      Object.assign({}, c, {stackLife:1000, replacement:100}), d
    );
    near(r.rows[0].a.replacements, 8, "Reposiciones");
    near(r.rows[0].replacements, 800, "Coste");
    near(r.rows[0].a.ageFinal, 760, "Edad");
  });

  test("Año bisiesto y febrero UTC", () => {
    const dates = annualDates(2024);
    const r = originalCalculate(c, {
      name:"Bisiesto", timestamps:dates, solar:new Array(8784).fill(1)
    });
    near(r.rows[0].a.kg, 17568, "Producción");
    near(r.rows[0].a.months[1], 29 * 24 * 2, "Febrero");
  });

  test("Fechas inexistentes, sin zona y duplicadas rechazadas", () => {
    mustReject(() => parseInstant("2024-02-30T00:00:00Z"));
    mustReject(() => parseInstant("2024-01-01T00:00:00"));
    const dates = annualDates(2024);
    dates[1] = dates[0];
    mustReject(() => validateTimeline(dates));
  });

  test("Normalización de desfase horario", () => {
    near(
      parseInstant("2024-01-01T01:00:00+01:00"),
      parseInstant("2024-01-01T00:00:00Z"),
      "Instante UTC"
    );
  });

  test("Interpolación y no extrapolación", () => {
    const curve = validateCurve(testCurve());
    near(curveSEC(curve, 0.625), 55, "Interpolación");
    mustReject(() => curveSEC(curve, 0.1));
    mustReject(() => validateCurve(Object.assign({}, testCurve(), {perimeter:"system_ac"})));
  });

  test("Despacho con curva variable", () => {
    const r = originalCalculate(c, {
      name:"Curva",
      solar:new Array(8760).fill(0.625),
      curve:testCurve()
    });
    near(r.rows[0].a.kg, 8760 * 62.5 / 55, "Producción con curva", 0.001);
    near(r.rows[0].a.residual, 0, "Balance", 0.0001);
  });

  test("Batería y curva: cierre eléctrico", () => {
    const r = originalCalculate(
      Object.assign({}, c, {
        pv:200, battery:true, batCap:1, batPower:0.1,
        batEff:90, socMin:10, socMax:90
      }),
      {
        name:"Alternancia",
        solar:Array.from({length:8760}, (_, h) => h % 24 < 12 ? 1 : 0),
        curve:testCurve()
      }
    );
    near(r.rows[0].a.residual, 0, "Balance", 0.001);
    if (r.rows[0].a.batteryLoss < 0) fail("Pérdidas negativas.");
  });

  test("Resultados separados de los objetos de entrada", () => {
    const input = Object.assign({}, c);
    const data = copy(d);
    const r = originalCalculate(input, data);
    input.sec = 100;
    data.solar[0] = 0;
    near(r.c.sec, 50, "Parámetro");
    near(r.data.solar[0], 1, "Serie");
  });

  health = {
    passed:cases.every(t => t.passed),
    executedAt:new Date().toISOString(),
    cases:cases
  };

  $("professionalHealth").textContent =
    cases.filter(t => t.passed).length + " de " + cases.length +
    " pruebas superadas. " +
    (health.passed ? "Motor habilitado." : "Motor bloqueado.");

  $("professionalCases").innerHTML = table(
    ["Prueba", "Estado", "Detalle"],
    cases.map(t => [t.name, t.passed ? "Superada" : "Fallo", t.detail])
  );

  return health;
}

async function exportAudit() {
  const r = requireResult();
  if (busy || calculating) fail("Espere a que termine el cálculo.");

  const payload = {
    schema:"h2verde-audit-2",
    engine:ENGINE,
    calculatedAt:r.created,
    project:{
      app:"H2-Verde-Consolidado",
      version:RELEASE,
      config:copy(r.c),
      series:r.data ? copy(r.data) : null
    },
    activeProfiles:{
      timestamps:r.profiles.timestamps,
      solar:Array.from(r.profiles.solar),
      wind:Array.from(r.profiles.wind),
      pricesEurMwh:Array.from(r.profiles.prices),
      curve:r.profiles.curve
    },
    annual:r.rows.map(row => {
      const a = Object.assign({}, row.a);
      delete a.H;
      return Object.assign({}, row, {a:a});
    }),
    cashFlows:r.cashFlows,
    economics:{
      initialCapex:r.initialCapex,
      grossLcoh:r.grossLcoh,
      netLcoh:r.netLcoh,
      npv:r.npv,
      irr:r.irr,
      payback:r.payback
    },
    provenance:r.professional,
    sensitivity:sensitivityOutput
  };

  const hash = await sha256(canonical(payload));

  download(
    "h2verde-expediente-3.2.json",
    JSON.stringify({
      integrity:{
        algorithm:hash ? "SHA-256" : "No disponible",
        payloadSha256:hash,
        serialization:"Claves ordenadas; números no finitos como null",
        meaning:"Integridad del expediente; no certificación científica"
      },
      payload:payload
    }, null, 2),
    "application/json"
  );

  status("Expediente exportado con calendario y curva.");
}

async function sensitivity() {
  if (busy || calculating) fail("Ya hay un cálculo en curso.");
  const base = requireResult();
  const c = copy(base.c);
  const data = base.data ? copy(base.data) : null;
  const rows = [["Base", base.netLcoh, base.npv, "Calculado"]];

  busy = true;
  $("professionalSensitivity").disabled = true;

  try {
    const jobs = [
      ["Consumo DC −10 %", "consumption", 0.9],
      ["Consumo DC +10 %", "consumption", 1.1],
      ["CAPEX renovable −10 %", "capRenew", 0.9],
      ["CAPEX renovable +10 %", "capRenew", 1.1],
      ["Descuento −10 %", "rate", 0.9],
      ["Descuento +10 %", "rate", 1.1]
    ];

    for (const [label, key, factor] of jobs) {
      $("professionalSensitivityStatus").textContent = "Evaluando: " + label;
      await new Promise(resolve => setTimeout(resolve, 20));

      const alternative = copy(c);
      const series = data ? copy(data) : null;

      try {
        if (key === "consumption") {
          if (series?.curve) {
            series.curve.points.forEach(p => p.secKwhKg *= factor);
          } else {
            alternative.sec *= factor;
          }
        } else {
          alternative[key] *= factor;
        }

        const r = calculate(alternative, series);
        rows.push([label, r.netLcoh, r.npv, "Calculado"]);
      } catch (e) {
        rows.push([label, null, null, e.message]);
      }
    }

    if (result !== base) fail("El escenario cambió. Sensibilidad descartada.");

    sensitivityOutput = {
      calculatedAt:new Date().toISOString(),
      baseCalculatedAt:base.created,
      method:"Motor completo; alternativas univariantes ±10 %",
      rows:rows
    };

    $("professionalSensitivityTable").innerHTML = table(
      ["Alternativa", "LCOH €/kg", "VAN €", "Estado"],
      rows.map(row => [
        row[0], format(row[1], 3), format(row[2], 0), row[3]
      ])
    );

    $("professionalSensitivityStatus").textContent =
      "Finalizado. No constituye incertidumbre probabilística.";
  } finally {
    busy = false;
    $("professionalSensitivity").disabled = false;
  }
}

/*
 * Capturar el cálculo principal evita que el manejador antiguo
 * lea datos durante una espera o publique un resultado fallido anterior.
 */
function bindMainCalculation() {
  $("form").addEventListener("submit", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    guard(async function () {
      if (calculating || busy) fail("Espere a que termine el cálculo.");
      if (!health.passed) fail("Motor bloqueado por pruebas fallidas.");

      const frozenConfig = readForm();
      const frozenData = bundle(imported, selectedCurve);
      const controls = Array.from(
        document.querySelectorAll("main input, main select, main button")
      );
      const states = controls.map(el => [el, el.disabled]);

      invalidate();
      calculating = true;
      controls.forEach(el => el.disabled = true);
      status("Calculando calendario y curva…");

      try {
        await new Promise(resolve => setTimeout(resolve, 25));
        const next = calculate(frozenConfig, frozenData);
        config = frozenConfig;
        result = next;
        renderResults(next);
        selectTab("resultados");
        status("Resultado calculado. Balances comprobados por intervalo y año.");
      } catch (e) {
        invalidate();
        throw e;
      } finally {
        calculating = false;
        states.forEach(([el, disabled]) => el.disabled = disabled);
      }
    })();
  }, true);
}

addInterface();

$("professionalTests").addEventListener("click", guard(function () {
  if (busy || calculating) fail("Espere a que termine el cálculo.");
  invalidate();
  executeTests();
  status(
    health.passed ? "Pruebas superadas." : "Pruebas fallidas: motor bloqueado.",
    !health.passed
  );
}));

$("professionalAudit").addEventListener("click", guard(exportAudit));
$("professionalSensitivity").addEventListener("click", guard(sensitivity));

bindMainCalculation();
renderSeriesInfo();
executeTests();

if (location.hash === "#calidad") selectTab("calidad");

status(
  health.passed
    ? "Versión 3.2 preparada. Pruebas superadas; pendiente de validación externa."
    : "Versión 3.2 bloqueada: revise Calidad y trazabilidad.",
  !health.passed
);

})();
