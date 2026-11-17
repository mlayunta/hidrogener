/* =====================================================================
   H2 VERDE · Módulo térmico y de arranques · v1
   - Inercia térmica del stack y energía de calentamiento por arranque
   - Recuento de arranques y de violaciones de tiempo mínimo
     encendido/apagado a partir del perfil de carga real
   - Penalización energética incorporada al balance y al LCOH
   Instalación: añadir <script src="./h2termico.js"></script> antes de </body>
   ===================================================================== */
(function () {
"use strict";

var VERSION="v1";

/* ======================= ESQUEMA ======================= */
SCHEMA.push({g:"11 · Térmica y arranques",f:[
  ["thermOn","Contabilizar térmica y arranques","bool",true],
  ["stackMassPerMW","Masa térmica del stack","num",3000,200,20000,100,"kg/MW","PEM: 2 000–5 000. AEL: 4 000–8 000. SOEC: 5 000–12 000."],
  ["cpStack","Calor específico del conjunto","num",0.8,0.3,2,0.05,"kJ/(kg·K)"],
  ["ambientT","Temperatura ambiente media","num",15,-20,45,1,"°C"],
  ["startupAux","Sobrecoste de auxiliares en el arranque","num",15,0,100,5,"% de la energía térmica"],
  ["startupElecPct","Fracción eléctrica de la energía de arranque","num",50,0,100,5,"%"],
  ["startupTimeMin","Tiempo de arranque en frío","num",15,1,360,1,"min","PEM: 5–30. AEL: 30–60. SOEC: 120–360."],
  ["minUpTime","Tiempo mínimo encendido","num",1,0,24,0.5,"h"],
  ["minDownTime","Tiempo mínimo apagado","num",1,0,24,0.5,"h"]
]});
DEFAULTS.thermOn=true;DEFAULTS.stackMassPerMW=3000;DEFAULTS.cpStack=0.8;DEFAULTS.ambientT=15;
DEFAULTS.startupAux=15;DEFAULTS.startupElecPct=50;DEFAULTS.startupTimeMin=15;
DEFAULTS.minUpTime=1;DEFAULTS.minDownTime=1;
["thermOn","stackMassPerMW","cpStack","ambientT","startupAux","startupElecPct","startupTimeMin","minUpTime","minDownTime"].forEach(function(k){
  if(state[k]===undefined)state[k]=DEFAULTS[k];
});

/* ======================= ANÁLISIS TÉRMICO ======================= */
function thermalAnalysis(load,P,s){
  var N=load.length,starts=0,prev=0,i;
  var minUp=num(s.minUpTime),minDown=num(s.minDownTime);
  var upViol=0,downViol=0,runLen=0,offLen=0,runHours=0,offHours=0;
  var longestRun=0,longestOff=0;
  for(i=0;i<N;i++){
    var on=load[i]>0.001?1:0;
    if(on&&!prev)starts++;
    if(on){runLen++;offHours+=offLen;if(offLen>longestOff)longestOff=offLen;if(offLen>0&&offLen<minDown)downViol++;offLen=0;}
    else{offLen++;runHours+=runLen;if(runLen>longestRun)longestRun=runLen;if(runLen>0&&runLen<minUp)upViol++;runLen=0;}
    prev=on;
  }
  var mass=num(s.stackMassPerMW)*P.pNomMW;
  var dT=Math.max(0,num(s.stackT)-num(s.ambientT));
  var cp=num(s.cpStack);
  var qKwh=mass*cp*dT/3600;
  var perStart=qKwh*(1+num(s.startupAux)/100);
  var elecPerStart=perStart*clamp(num(s.startupElecPct)/100,0,1);
  var totalMWh=starts*elecPerStart/1000;
  var startupHours=starts*num(s.startupTimeMin)/60;
  return {starts:starts,mass:mass,dT:dT,qKwh:qKwh,perStart:perStart,elecPerStart:elecPerStart,
    totalMWh:totalMWh,startupHours:startupHours,upViol:upViol,downViol:downViol,
    runHours:runHours,offHours:offHours,longestRun:longestRun,longestOff:longestOff};
}

/* ======================= PARCHE DE simYear ======================= */
var _simYear=window.simYear;
window.simYear=function(cfg,lut){
  var r=_simYear(cfg,lut);
  if(!state.thermOn)return r;
  try{
    var th=thermalAnalysis(r.H.load,cfg.stack,state);
    r.therm=th;
    r.bopE+=th.totalMWh;
    r.acUsed+=th.totalMWh/cfg.stack.rect;
  }catch(e){if(window.console)console.warn("[h2termico]",e);}
  return r;
};
var _recalc=window.recalc;
window.recalc=function(){
  _recalc();
  try{if(window.result)renderTermico(window.result);}catch(e){if(window.console)console.warn("[h2termico] render",e);}
};

/* ======================= UI ======================= */
(function(){
  var host=document.querySelector("#tab-horario");
  if(!host)return;
  var card=document.createElement("div");
  card.className="card";
  card.innerHTML='<h2>Análisis térmico y de arranques</h2><div id="termBox"></div>';
  host.appendChild(card);
})();

function renderTermico(r){
  var box=document.getElementById("termBox");
  if(!box||!r||!r.y0||!r.y0.r||!r.y0.r.therm)return;
  var th=r.y0.r.therm;
  var e=r.econ;
  var costPerYear=th.totalMWh*1000*num(state.elecPrice);
  var lcohImpact=(e.npvKg>0)?(costPerYear/ (r.y0.kg||1)):0;
  var tiles=[
    metric("Arranques al año",fmt0(th.starts),fmt(th.starts/365,2)+" por día"),
    metric("Masa térmica del stack",fmt0(th.mass)+" kg",fmt(th.mass/1000,1)+" t"),
    metric("Salto térmico",fmt(th.dT,0)+" K",fmt(num(state.stackT),0)+" °C de operación"),
    metric("Energía térmica por arranque",fmt(th.qKwh,1)+" kWh","con auxiliares: "+fmt(th.perStart,1)+" kWh"),
    metric("Energía eléctrica por arranque",fmt(th.elecPerStart,1)+" kWh",fmt(num(state.startupElecPct),0)+" % del total"),
    metric("Energía anual de arranques",fmt(th.totalMWh,1)+" MWh/año",fmt(100*th.totalMWh/Math.max(r.y0.r.stackE,1e-9),2)+" % de la energía del stack"),
    metric("Coste anual de arranques",fmt0(costPerYear)+" €/año",fmt(lcohImpact,4)+" €/kg"),
    metric("Horas perdidas en arranques",fmt(th.startupHours,0)+" h/año",fmt(100*th.startupHours/8760,1)+" % del año")
  ].join("");
  var viol=th.upViol+th.downViol;
  var cls=viol===0?"ok":(viol<50?"warn":"bad");
  var msgTxt=viol===0
    ? "El perfil de operación respeta los tiempos mínimos encendido y apagado configurados."
    : "Se detectan <strong>"+fmt0(viol)+"</strong> transiciones más cortas que el tiempo mínimo ("+fmt0(th.upViol)+" encendidos cortos, "+fmt0(th.downViol)+" apagados cortos). El despacho actual no impone esa restricción: son un aviso de que el perfil real exigiría más arranques de los admisibles.";
  box.innerHTML='<div class="metrics">'+tiles+'</div>'+
  '<div class="note '+cls+'" style="margin-top:12px">'+msgTxt+'</div>'+
  '<table style="margin-top:10px"><thead><tr><th>Régimen</th><th>Horas</th><th>Fracción</th><th>Racha más larga</th></tr></thead><tbody>'+
  '<tr><td>En operación</td><td>'+fmt0(th.runHours)+' h</td><td>'+fmt(100*th.runHours/8760,1)+' %</td><td>'+fmt0(th.longestRun)+' h</td></tr>'+
  '<tr><td>Parado</td><td>'+fmt0(th.offHours)+' h</td><td>'+fmt(100*th.offHours/8760,1)+' %</td><td>'+fmt0(th.longestOff)+' h</td></tr>'+
  '</tbody></table>'+
  '<p style="color:var(--muted);font-size:.82rem;margin-top:10px">'+
  'Energía de arranque = masa × c<sub>p</sub> × ΔT × (1 + auxiliares) = '+fmt0(th.mass)+' × '+fmt(num(state.cpStack),2)+' × '+fmt(th.dT,0)+' / 3 600 = <strong>'+fmt(th.qKwh,1)+' kWh</strong> por arranque. '+
  'La fracción eléctrica se incorpora al balance y al LCOH; las horas de arranque se reportan pero no se descuentan de la producción (hipótesis favorable a la planta).</p>';
}

/* ======================= ARRANQUE ======================= */
function start(){
  renderForm();
  try{recalc();}catch(e){if(window.console)console.warn("[h2termico] recalc",e);}
  if(window.result)renderTermico(window.result);
  if(window.console)console.log("[h2termico] "+VERSION+" cargado correctamente.");
}
var bootTries=0;
function boot(){
  bootTries++;
  var ok=window.simulate&&window.SCHEMA&&window.state&&window.derive&&window.simYear;
  var listo=ok&&(document.getElementById("projSelect")||bootTries>40);
  if(!listo){setTimeout(boot,80);return;}
  try{start();}catch(e){if(window.console)console.error("[h2termico]",e);}
}
boot();
})();
