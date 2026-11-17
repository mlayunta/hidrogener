/* =====================================================================
   H2 VERDE · Módulo de extensión · v2 · Miguel Ángel Layunta López
   1) Validación contra plantas de referencia (métricas de error)
   2) Degradación dinámica por ciclado (rainflow)
   3) LCOH probabilístico P10/P50/P90 (Monte Carlo + índices de Sobol)
   Instalación: añadir <script src="./h2modules.js"></script> antes de </body>
   ---------------------------------------------------------------------
   v2 · Arreglo A: boot() espera a que init() termine de cargar el proyecto
      · Arreglo B: start() fuerza un recálculo con el motor ya parcheado
      · Chip de versión en la cabecera para verificación
      · runValidation() tolerante a fallos por caso
   ===================================================================== */
(function () {
"use strict";

var VERSION = "v2";

/* ======================= UTILIDADES ======================= */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function normInv(p){
  p=Math.min(1-1e-9,Math.max(1e-9,p));
  var a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
  var b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
  var c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
  var d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
  var pl=0.02425,q,r;
  if(p<pl){q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p<=1-pl){q=p-0.5;r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
  q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}
function lhs(n,k,rng){
  var M=[],i,j;
  for(i=0;i<n;i++)M.push(new Array(k));
  for(j=0;j<k;j++){
    var col=[];
    for(i=0;i<n;i++)col.push((i+rng())/n);
    for(i=n-1;i>0;i--){var s=Math.floor(rng()*(i+1)),t=col[i];col[i]=col[s];col[s]=t;}
    for(i=0;i<n;i++)M[i][j]=col[i];
  }
  return M;
}
function mean(a){var s=0,i;for(i=0;i<a.length;i++)s+=a[i];return a.length?s/a.length:0;}
function variance(a){var m=mean(a),s=0,i;for(i=0;i<a.length;i++)s+=(a[i]-m)*(a[i]-m);return a.length>1?s/(a.length-1):0;}
function percentile(sorted,p){
  if(!sorted.length)return NaN;
  var idx=(sorted.length-1)*p,lo=Math.floor(idx),hi=Math.ceil(idx);
  if(lo===hi)return sorted[lo];
  return sorted[lo]+(sorted[hi]-sorted[lo])*(idx-lo);
}
function svgBars(el,values,labels,opt){
  if(!el)return;
  opt=opt||{};
  var W=1000,H=opt.h||300,L=64,R=16,T=18,B=42,n=values.length,i;
  var maxY=opt.maxY||1e-9;
  for(i=0;i<n;i++)if(values[i]>maxY)maxY=values[i];
  var bw=(W-L-R)/Math.max(1,n),g="";
  for(var k=0;k<=4;k++){
    var y=T+k*(H-T-B)/4,v=maxY*(1-k/4);
    g+='<line x1="'+L+'" y1="'+y.toFixed(1)+'" x2="'+(W-R)+'" y2="'+y.toFixed(1)+'" stroke="#e2ece7"/>';
    g+='<text x="'+(L-6)+'" y="'+(y+3.5).toFixed(1)+'" font-size="10" fill="#7b918a" text-anchor="end">'+fmt(v,opt.dec||0)+'</text>';
  }
  for(i=0;i<n;i++){
    var h=(values[i]/maxY)*(H-T-B),x=L+i*bw+bw*0.15,w=bw*0.7;
    g+='<rect x="'+x.toFixed(1)+'" y="'+(H-B-h).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.max(0,h).toFixed(1)+'" fill="'+(opt.color||"#11956e")+'" rx="2"><title>'+esc(labels[i])+': '+fmt(values[i],opt.dec||0)+'</title></rect>';
    if(bw>30)g+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(H-B+14)+'" font-size="10" fill="#7b918a" text-anchor="middle">'+esc(labels[i])+'</text>';
  }
  g+='<line x1="'+L+'" y1="'+(H-B)+'" x2="'+(W-R)+'" y2="'+(H-B)+'" stroke="#b9cec5"/>';
  el.innerHTML=g;
}
function kvGet(key){
  if(typeof idb!=="function")return Promise.resolve(null);
  return idb().then(function(db){return new Promise(function(res){var q=db.transaction("kv","readonly").objectStore("kv").get(key);q.onsuccess=function(){res(q.result);};q.onerror=function(){res(null);};});}).catch(function(){return null;});
}
function kvPut(key,val){
  if(typeof idb!=="function")return Promise.resolve();
  return idb().then(function(db){return new Promise(function(res){var tx=db.transaction("kv","readwrite");tx.objectStore("kv").put(val,key);tx.oncomplete=function(){res();};tx.onerror=function(){res();};});}).catch(function(){});
}

/* ======================= ESTADO DEL MÓDULO ======================= */
var MOD={
  calib:{AEL:1,PEM:1,SOEC:1,AEM:1},
  mc:[
    {k:"elecPrice",l:"Precio eléctrico",d:"lognormal",cv:0.25,on:true},
    {k:"capexPV",l:"CAPEX renovable",d:"normal",cv:0.15,on:true},
    {k:"capexStack",l:"CAPEX electrolizador",d:"normal",cv:0.15,on:true},
    {k:"asr",l:"ASR del stack",d:"normal",cv:0.10,on:true},
    {k:"degBase",l:"Degradación base",d:"lognormal",cv:0.30,on:true},
    {k:"pvKwp",l:"Potencia FV",d:"normal",cv:0.06,on:true},
    {k:"rate",l:"Tasa de descuento",d:"normal",cv:0.12,on:true},
    {k:"etaF",l:"Eficiencia farádica",d:"normal",cv:0.01,on:true},
    {k:"h2Price",l:"Precio de venta H₂",d:"normal",cv:0.20,on:true}
  ],
  valCases:[
    {id:"refhyne",on:true,name:"REFHYNE I · Shell Rheinland (Wesseling, DE)",tech:"PEM",mw:10,year:2021,
     src:"Proyecto REFHYNE (Clean Hydrogen Partnership). Valores de referencia orientativos.",
     ref:{cons:57,eta:58,minLoad:5,deg:6,avail:95}},
    {id:"puertollano",on:true,name:"Puertollano · Iberdrola (Ciudad Real, ES)",tech:"PEM",mw:20,year:2022,
     src:"Planta de Puertollano (Iberdrola). Valores de referencia orientativos.",
     ref:{cons:55,eta:60,minLoad:5,deg:5,avail:92}},
    {id:"fh2r",on:true,name:"FH2R · NEDO/Toshiba (Fukushima, JP)",tech:"AEL",mw:10,year:2020,
     src:"Fukushima Hydrogen Energy Research Field (NEDO). Valores de referencia orientativos.",
     ref:{cons:52,eta:64,minLoad:15,deg:8,avail:90}}
  ],
  mcOut:null,sobolOut:null,valOut:null
};

/* ======================= 1 · RAINFLOW ======================= */
function rainflow(load,minRange,m){
  var n=load.length,tp=[],i;
  for(i=0;i<n;i++){
    if(i===0||i===n-1){tp.push(load[i]);continue;}
    var a=load[i-1],b=load[i],c=load[i+1];
    if((b>=a&&b>=c)||(b<=a&&b<=c))tp.push(b);
  }
  var stack=[],cycles=[],j;
  for(j=0;j<tp.length;j++){
    stack.push(tp[j]);
    while(stack.length>=3){
      var L=stack.length;
      var X=Math.abs(stack[L-1]-stack[L-3]);
      var Y=Math.abs(stack[L-2]-stack[L-3]);
      if(X<Y)break;
      cycles.push({range:Math.abs(stack[L-1]-stack[L-2]),mean:(stack[L-1]+stack[L-2])/2,count:1});
      stack.splice(L-3,2);
    }
  }
  for(var k=0;k<stack.length-1;k++)cycles.push({range:Math.abs(stack[k+1]-stack[k]),mean:(stack[k+1]+stack[k])/2,count:0.5});
  var bins=[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0],hist=[0,0,0,0,0,0,0,0,0,0];
  var Neq=0,total=0,maxR=0,full=0;
  cycles.forEach(function(c){
    if(c.range<minRange)return;
    total+=c.count;
    Neq+=c.count*Math.pow(c.range,m);
    if(c.range>maxR)maxR=c.range;
    if(c.range>=0.9)full+=c.count;
    for(var b=0;b<bins.length;b++){if(c.range<=bins[b]){hist[b]+=c.count;break;}}
  });
  return {turningPoints:tp.length,cycles:cycles,count:total,Neq:Neq,maxRange:maxR,fullCycles:full,hist:hist,bins:bins};
}

/* ======================= 2 · EVALUACIÓN RÁPIDA (MC / Sobol) ======================= */
function evalFast(s,profiles){
  var P=derive(s),life=Math.max(1,Math.round(num(s.life)));
  var cfg={stack:P,solar:profiles.solar,wind:profiles.wind,pvKwp:num(s.pvKwp),pvPR:num(s.pvPR),windKw:num(s.windKw),allowGrid:!!s.allowGrid};
  var lut=buildLUT(P,P.deg*1e-6*4380);
  var y1=simYear(cfg,lut);
  var comp=compressH2(Math.max(1,P.P),Math.max(1.01,num(s.targetP)),Math.max(273.15,P.T+283.15),Math.max(1,Math.round(num(s.stages))),clamp(num(s.etaPoly)/100,0.3,0.95),num(s.intercoolT)+273.15,num(s.dpPct));
  var tpd=y1.kg/365/1000;
  var liqKwh=s.liqOn?clamp(5.5+12/Math.sqrt(Math.max(tpd,0.5)),5.5,25):0;
  var CAR=CARRIERS[s.carrier]||CARRIERS.none;
  var tl=num(s.transportLossPct)/100;
  var boil=s.liqOn?(num(s.boilOffPct)/100*365*0.5):0;
  var Vref=1.75,perYear=[];
  for(var y=0;y<life;y++){
    var dV=P.deg*1e-6*(y*8760+4380);
    var f=1/(1+dV/Vref);
    var kg=y1.kg*f;
    var compE=kg*comp.kWhPerKg,liqE=kg*liqKwh;
    var carrierE=kg*(CAR.elec+CAR.heat*C.LHV);
    var delivered=kg*(1-tl)*(1-CAR.loss)*(1-boil);
    perYear.push({r:y1,kg:kg,delivered:delivered,elecUsed:y1.acUsed*f+compE+liqE+carrierE});
  }
  return economics(s,perYear);
}

/* ======================= 3 · PARCHE DEL MOTOR ======================= */
var _simulate=window.simulate;
window.simulate=function(s,profiles){
  var rf=null,degEff=null;
  try{
    var P=derive(s);
    var cfg={stack:P,solar:profiles.solar,wind:profiles.wind,pvKwp:num(s.pvKwp),pvPR:num(s.pvPR),windKw:num(s.windKw),allowGrid:!!s.allowGrid};
    var lut=buildLUT(P,0);
    var y1=simYear(cfg,lut);
    rf=rainflow(y1.H.load,num(s.cycMinRange),num(s.cycExp));
    degEff=num(s.degBase)+num(s.kCyc)*rf.Neq/8760;
  }catch(e){rf=null;}
  var s2=s;
  if(rf&&s.degModel==="dynamic")s2=Object.assign({},s,{degRate:degEff});
  var res=_simulate(s2,profiles);
  if(rf){
    res.cycling=rf;
    res.degBaseRate=num(s.degBase);
    res.degCycRate=num(s.kCyc)*rf.Neq/8760;
    res.degEff=degEff;
    res.degLinear=num(s.degRate);
  }
  return res;
};

var _recalc=window.recalc;
window.recalc=function(){
  _recalc();
  try{
    if(window.result){
      renderCycling(window.result);
      if(MOD.valOut)renderValResults();
    }
  }catch(e){if(window.console)console.warn("[h2modules] render",e);}
};

/* ======================= 4 · ESQUEMA AMPLIADO ======================= */
SCHEMA.push({g:"8 · Degradación dinámica por ciclado",f:[
  ["degModel","Modelo de degradación","sel","dynamic",[["linear","Lineal en el tiempo (clásico)"],["dynamic","Dinámico por ciclado (rainflow)"]]],
  ["degBase","Degradación en operación estable","num",2,0,undefined,0.1,"µV/h","Se aplica siempre, con o sin ciclado."],
  ["kCyc","Daño por ciclo equivalente de profundidad completa","num",60,0,undefined,1,"µV/ciclo","Orden de magnitud publicado para PEM: 20–100 µV por ciclo arranque-parada."],
  ["cycExp","Exponente de la curva de daño (m)","num",2,0.5,5,0.1,"—","Daño = Σ n·(ΔL)^m. m=2 penaliza poco los ciclos someros."],
  ["cycMinRange","Profundidad mínima de ciclo contabilizada","num",0.02,0,1,0.01,"ΔL","Filtra el ruido numérico del conteo."]
]});
DEFAULTS.degModel="dynamic";DEFAULTS.degBase=2;DEFAULTS.kCyc=60;DEFAULTS.cycExp=2;DEFAULTS.cycMinRange=0.02;
["degModel","degBase","kCyc","cycExp","cycMinRange"].forEach(function(k){if(state[k]===undefined)state[k]=DEFAULTS[k];});

/* ======================= 5 · UI: PESTAÑAS NUEVAS ======================= */
function switchTab(id){
  Array.prototype.forEach.call(document.querySelectorAll("nav.tabs button"),function(x){x.setAttribute("aria-selected",String(x.dataset.tab===id));});
  Array.prototype.forEach.call(document.querySelectorAll(".panel"),function(p){p.classList.toggle("active",p.id==="tab-"+id);});
  window.scrollTo({top:0,behavior:"smooth"});
}
function addTab(id,label,html){
  var nav=document.querySelector("nav.tabs");
  if(!nav)return;
  var btn=document.createElement("button");
  btn.setAttribute("role","tab");btn.dataset.tab=id;btn.setAttribute("aria-selected","false");btn.textContent=label;
  btn.addEventListener("click",function(){switchTab(id);});
  nav.appendChild(btn);
  var sec=document.createElement("section");
  sec.id="tab-"+id;sec.className="panel";sec.innerHTML=html;
  document.querySelector("main").appendChild(sec);
}
function addChip(){
  var chips=document.querySelector("header.app .chips");
  if(!chips)return;
  var c=document.createElement("span");
  c.className="chip ok";c.id="chipMod";c.textContent="Módulo: "+VERSION;
  chips.appendChild(c);
}

addChip();

addTab("validacion","9 · Validación",
'<div class="card"><h2>Validación contra plantas de referencia</h2>'+
'<div class="note warn"><strong>Valores de referencia orientativos.</strong> Proceden de información pública de los proyectos y <strong>no han sido verificados</strong> contra sus informes finales. Edítelos con los datos publicados o medidos de su proyecto antes de sacar conclusiones. El valor del módulo es el <em>mecanismo</em> de comparación y las métricas de error.</div>'+
'<div class="scroll"><table id="valCases"></table></div>'+
'<div class="toolbar"><button class="btn" id="valRun">Ejecutar validación</button>'+
'<button class="btn ghost" id="valCal">Calibrar ASR automáticamente</button>'+
'<button class="btn ghost" id="valReset">Restaurar referencias</button>'+
'<span id="valMsg" style="color:var(--muted);font-size:.83rem"></span></div></div>'+
'<div class="card"><h2>Resultados</h2><div id="valSummary" class="metrics"></div>'+
'<div class="scroll"><table id="valResults"></table></div>'+
'<div class="scroll"><svg id="valChart" class="chart" viewBox="0 0 1000 300" role="img" aria-label="Comparación modelo vs referencia"></svg></div>'+
'<p style="color:var(--muted);font-size:.82rem">El ensayo se realiza a <strong>punto nominal</strong> (carga 100 %, sin recurso renovable) para aislar el modelo electroquímico del recurso. MAPE = error porcentual absoluto medio. RMSE en kWh/kg.</p></div>');

addTab("incertidumbre","10 · Incertidumbre",
'<div class="card"><h2>Parámetros inciertos</h2>'+
'<p style="color:var(--muted);font-size:.84rem;margin-top:0">Cada parámetro se muestrea alrededor de su valor actual con el coeficiente de variación indicado. Distribución <em>lognormal</em> para magnitudes estrictamente positivas y asimétricas; <em>normal</em> para el resto.</p>'+
'<div class="scroll"><table id="mcParams"></table></div>'+
'<div class="toolbar"><label style="font-weight:650;font-size:.85rem">Muestras <input type="number" id="mcN" value="400" min="50" max="5000" step="50" style="width:110px;display:inline-block"></label>'+
'<button class="btn" id="mcRun">Ejecutar Monte Carlo</button>'+
'<button class="btn ghost" id="sobolRun">Ejecutar Sobol</button>'+
'<span id="mcMsg" style="color:var(--muted);font-size:.83rem"></span></div>'+
'<div style="height:8px;background:#e6f5ef;border-radius:4px;overflow:hidden"><div id="mcBar" style="height:100%;width:0;background:#11956e;transition:width .12s"></div></div></div>'+
'<div class="card"><h2>Distribución del LCOH</h2><div id="mcStats" class="metrics"></div>'+
'<div class="two"><div><h3>Histograma</h3><div class="scroll"><svg id="mcHist" class="chart" viewBox="0 0 1000 300" role="img" aria-label="Histograma del LCOH"></svg></div></div>'+
'<div><h3>Curva de excedencia</h3><div class="scroll"><svg id="mcCdf" class="chart" viewBox="0 0 1000 300" role="img" aria-label="Curva de excedencia"></svg></div></div></div></div>'+
'<div class="card"><h2>Índices de Sobol (primer orden y total)</h2>'+
'<p style="color:var(--muted);font-size:.84rem;margin-top:0">Estimadores de Jansen sobre un diseño Saltelli. S₁ mide el efecto directo del parámetro; S_Ti incluye sus interacciones. La suma de S₁ &lt; 1 indica interacción entre parámetros.</p>'+
'<div class="scroll"><table id="sobolTable"></table></div>'+
'<div class="scroll"><svg id="sobolChart" class="chart" viewBox="0 0 1000 320" role="img" aria-label="Índices de Sobol"></svg></div></div>');

(function(){
  var host=document.querySelector("#tab-horario");
  if(!host)return;
  var card=document.createElement("div");
  card.className="card";
  card.innerHTML='<h2>Análisis de ciclado (rainflow) y degradación</h2><div id="cycBox"></div>';
  host.appendChild(card);
})();

/* ======================= 6 · RENDER: CICLADO ======================= */
function renderCycling(r){
  var box=document.getElementById("cycBox");
  if(!box||!r||!r.cycling)return;
  var rf=r.cycling;
  var base=r.degBaseRate||0,cyc=r.degCycRate||0,eff=r.degEff||0,lin=r.degLinear||0;
  var share=eff>0?(100*cyc/eff):0;
  var tiles=[
    metric("Puntos de giro del perfil",fmt0(rf.turningPoints)),
    metric("Ciclos contabilizados",fmt0(rf.count)),
    metric("Ciclos equivalentes (Neq)",fmt0(rf.Neq)),
    metric("Ciclos de profundidad ≥ 0,9",fmt0(rf.fullCycles)),
    metric("Profundidad máxima",fmt(rf.maxRange*100,1)+" %"),
    metric("Degradación base",fmt(base,2)+" µV/h"),
    metric("Degradación por ciclado",fmt(cyc,2)+" µV/h",fmt(share,0)+" % del total"),
    metric("Tasa efectiva",fmt(eff,2)+" µV/h","modelo lineal: "+fmt(lin,2)+" µV/h",eff>lin?"warn":"alt")
  ].join("");
  var labels=rf.bins.map(function(b){return fmt(b*100,0)+"%";});
  box.innerHTML='<div class="metrics">'+tiles+'</div>'+
  '<h3>Distribución de profundidad de ciclo</h3>'+
  '<div class="scroll"><svg id="cycHist" class="chart" viewBox="0 0 1000 280" role="img" aria-label="Histograma de ciclos"></svg></div>'+
  '<p style="color:var(--muted);font-size:.82rem;margin-top:8px">'+
  'Daño acumulado = Σ n·(ΔL)<sup>'+fmt(num(state.cycExp),1)+'</sup> = <strong>'+fmt(rf.Neq,1)+'</strong> ciclos equivalentes/año. '+
  'Tasa efectiva = '+fmt(base,2)+' + '+fmt(num(state.kCyc),0)+' × '+fmt(rf.Neq,1)+' / 8 760 = <strong>'+fmt(eff,2)+' µV/h</strong>. '+
  'Con el modelo lineal clásico la tasa sería constante de '+fmt(lin,2)+' µV/h: la diferencia es el coste real del ciclado.</p>';
  svgBars(document.getElementById("cycHist"),rf.hist,labels,{h:280,dec:0,color:"#34ad70"});
}

/* ======================= 7 · VALIDACIÓN ======================= */
function renderValCases(){
  var t=document.getElementById("valCases");
  if(!t)return;
  t.innerHTML='<thead><tr><th>Activo</th><th>Caso</th><th>Tec.</th><th>MW</th><th>Año</th>'+
  '<th>Consumo sistema (kWh/kg)</th><th>η LHV (%)</th><th>Carga mín. (%)</th><th>Degradación (µV/h)</th><th>Disponibilidad (%)</th><th>Fuente</th></tr></thead><tbody>'+
  MOD.valCases.map(function(c,i){
    return '<tr data-i="'+i+'">'+
    '<td><input type="checkbox" data-f="on"'+(c.on?" checked":"")+'></td>'+
    '<td><input data-f="name" value="'+esc(c.name)+'" style="min-width:250px"></td>'+
    '<td><select data-f="tech">'+["AEL","PEM","SOEC","AEM"].map(function(x){return '<option'+(c.tech===x?" selected":"")+'>'+x+'</option>';}).join("")+'</select></td>'+
    '<td><input type="number" step="0.5" data-f="mw" value="'+c.mw+'"></td>'+
    '<td><input type="number" step="1" data-f="year" value="'+c.year+'"></td>'+
    '<td><input type="number" step="0.5" data-f="ref.cons" value="'+c.ref.cons+'"></td>'+
    '<td><input type="number" step="0.5" data-f="ref.eta" value="'+c.ref.eta+'"></td>'+
    '<td><input type="number" step="1" data-f="ref.minLoad" value="'+c.ref.minLoad+'"></td>'+
    '<td><input type="number" step="0.5" data-f="ref.deg" value="'+c.ref.deg+'"></td>'+
    '<td><input type="number" step="1" data-f="ref.avail" value="'+c.ref.avail+'"></td>'+
    '<td><input data-f="src" value="'+esc(c.src)+'" style="min-width:220px"></td></tr>';
  }).join("")+'</tbody>';
}
document.addEventListener("input",function(ev){
  var tr=ev.target&&ev.target.closest?ev.target.closest("tr[data-i]"):null;
  if(!tr||!tr.parentNode||!tr.parentNode.parentNode||tr.parentNode.parentNode.id!=="valCases")return;
  var c=MOD.valCases[parseInt(tr.dataset.i,10)],f=ev.target.dataset.f;
  if(!c||!f)return;
  if(f.indexOf("ref.")===0){
    var k=f.slice(4);
    c.ref[k]=(ev.target.type==="number")?num(ev.target.value):ev.target.value;
  }else{
    c[f]=(ev.target.type==="checkbox")?ev.target.checked:((ev.target.type==="number")?num(ev.target.value):ev.target.value);
  }
  saveMOD();
});

function caseModel(c){
  var t=TECH[c.tech];
  var s=Object.assign({},state,{
    tech:c.tech,stackMW:c.mw,
    stackT:t.T,stackP:t.P,j0:t.j0,alpha:t.alpha,
    asr:t.asr*(MOD.calib[c.tech]||1),jlim:t.jlim,etaF:t.etaF*100,
    minLoad:100,allowGrid:true,degModel:"linear",degRate:c.ref.deg,
    liqOn:false,carrier:"none",transportLossPct:0,endEff:100,endExEff:100,
    heatRecovery:0,life:1
  });
  var P=derive(s);
  var zeros=new Float64Array(8760);
  var y=simYear({stack:P,solar:zeros,wind:zeros,pvKwp:0,pvPR:100,windKw:0,allowGrid:true},buildLUT(P,0));
  return {P:P,y:y,
    consStack:y.kg>0?(y.stackE*1000/y.kg):NaN,
    consSys:y.kg>0?(((y.stackE+y.bopE)/P.rect)*1000/y.kg):NaN,
    etaLHV:(y.kg>0)?(y.kg*C.LHV/(((y.stackE+y.bopE)/P.rect)*1000)*100):NaN,
    avail:100
  };
}
function runValidation(){
  var out=[];
  MOD.valCases.forEach(function(c){
    if(!c.on)return;
    try{
      var m=caseModel(c);
      out.push({c:c,consStack:m.consStack,consSys:m.consSys,etaLHV:m.etaLHV,minLoad:100,deg:c.ref.deg,avail:m.avail,
        V:cellV(m.y?0:0,m.P,0),j:0});
      var last=out[out.length-1];
      last.V=cellV(m.P.jlim*0.5,m.P,0);
      last.j=m.P.jlim*0.5;
    }catch(e){if(window.console)console.warn("[h2modules] caso "+c.id,e);}
  });
  MOD.valOut=out;
  renderValResults();
  saveMOD();
}
function renderValResults(){
  var out=MOD.valOut;
  if(!out||!out.length)return;
  var errs=[],sq=[],bias=[];
  var rows=out.map(function(o){
    var eCons=(o.consSys-o.c.ref.cons)/o.c.ref.cons*100;
    var eEta=(o.etaLHV-o.c.ref.eta)/o.c.ref.eta*100;
    var eDeg=(o.deg-o.c.ref.deg)/o.c.ref.deg*100;
    var eAv=(o.avail-o.c.ref.avail)/o.c.ref.avail*100;
    errs.push(Math.abs(eCons),Math.abs(eEta),Math.abs(eAv));
    sq.push(Math.pow(o.consSys-o.c.ref.cons,2));
    bias.push(o.consSys-o.c.ref.cons);
    function cell(m,ref,e){
      var cls=Math.abs(e)<=5?"ok":(Math.abs(e)<=15?"warn":"bad");
      return '<td>'+fmt(m,2)+'</td><td>'+fmt(ref,2)+'</td><td><span class="pill '+cls+'">'+fmt(e,1)+' %</span></td>';
    }
    return '<tr><td>'+esc(o.c.name)+'</td><td>'+o.c.tech+'</td>'+
      cell(o.consSys,o.c.ref.cons,eCons)+
      cell(o.etaLHV,o.c.ref.eta,eEta)+
      cell(o.deg,o.c.ref.deg,eDeg)+
      cell(o.avail,o.c.ref.avail,eAv)+
      '<td>'+fmt(o.V,3)+' V</td><td>'+fmt(o.j,3)+' A/cm²</td></tr>';
  }).join("");
  var mape=mean(errs),rmseV=Math.sqrt(mean(sq)),biasV=mean(bias);
  document.getElementById("valResults").innerHTML=
  '<thead><tr><th>Caso</th><th>Tec.</th><th>Consumo modelo</th><th>Consumo ref.</th><th>Error</th>'+
  '<th>η modelo</th><th>η ref.</th><th>Error</th><th>Deg. modelo</th><th>Deg. ref.</th><th>Error</th>'+
  '<th>Disp. modelo</th><th>Disp. ref.</th><th>Error</th><th>V celda</th><th>j</th></tr></thead><tbody>'+rows+'</tbody>';
  document.getElementById("valSummary").innerHTML=[
    metric("MAPE global",fmt(mape,1)+" %","media de errores absolutos",mape<=5?"alt":(mape<=15?"warn":"bad")),
    metric("RMSE (consumo)",fmt(rmseV,2)+" kWh/kg","raíz del error cuadrático medio"),
    metric("Sesgo (consumo)",fmt(biasV,2)+" kWh/kg",biasV>0?"modelo conservador":"modelo optimista",biasV>0?"alt":"warn"),
    metric("Casos evaluados",fmt0(out.length)),
    metric("Calibración ASR",["AEL","PEM","SOEC","AEM"].map(function(t){return t+" ×"+fmt(MOD.calib[t],2);}).join(" · "))
  ].join("");
  svgBars(document.getElementById("valChart"),out.map(function(o){return o.consSys;}),out.map(function(o){return o.c.tech;}),{h:300,dec:1,color:"#11956e"});
}
function errAt(tech,k){
  var e=0;
  MOD.valCases.forEach(function(c){
    if(!c.on||c.tech!==tech)return;
    try{
      var t=TECH[c.tech];
      var s=Object.assign({},state,{tech:c.tech,stackMW:c.mw,stackT:t.T,stackP:t.P,j0:t.j0,alpha:t.alpha,
        asr:t.asr*k,jlim:t.jlim,etaF:t.etaF*100,minLoad:100,allowGrid:true,degModel:"linear",degRate:c.ref.deg,
        liqOn:false,carrier:"none",transportLossPct:0,endEff:100,life:1});
      var P=derive(s),zeros=new Float64Array(8760);
      var y=simYear({stack:P,solar:zeros,wind:zeros,pvKwp:0,pvPR:100,windKw:0,allowGrid:true},buildLUT(P,0));
      var cons=y.kg>0?(((y.stackE+y.bopE)/P.rect)*1000/y.kg):1e9;
      e+=Math.pow(cons-c.ref.cons,2);
    }catch(x){e+=1e9;}
  });
  return e;
}
function calibrateASR(){
  var techs={};
  MOD.valCases.forEach(function(c){if(c.on)techs[c.tech]=true;});
  Object.keys(techs).forEach(function(t){
    var lo=0.4,hi=3.0;
    for(var it=0;it<40;it++){
      var m1=lo+(hi-lo)*0.382,m2=lo+(hi-lo)*0.618;
      if(errAt(t,m1)>errAt(t,m2))lo=m1;else hi=m2;
    }
    MOD.calib[t]=(lo+hi)/2;
  });
  runValidation();
  msg("Calibración completada. Multiplicadores ASR: "+Object.keys(MOD.calib).map(function(t){return t+" ×"+fmt(MOD.calib[t],3);}).join(", ")+".");
}
document.getElementById("valRun").addEventListener("click",function(){
  runValidation();
  msg("Validación ejecutada sobre "+(MOD.valOut?MOD.valOut.length:0)+" casos.");
});
document.getElementById("valCal").addEventListener("click",calibrateASR);
document.getElementById("valReset").addEventListener("click",function(){
  MOD.calib={AEL:1,PEM:1,SOEC:1,AEM:1};
  MOD.valCases.forEach(function(c){c.on=true;});
  renderValCases();runValidation();msg("Referencias y calibración restauradas.");
});

/* ======================= 8 · MONTE CARLO ======================= */
function renderMcParams(){
  var t=document.getElementById("mcParams");
  if(!t)return;
  t.innerHTML='<thead><tr><th>Activo</th><th>Parámetro</th><th>Clave</th><th>Distribución</th><th>Coef. variación (%)</th><th>Valor actual</th></tr></thead><tbody>'+
  MOD.mc.map(function(p,i){
    return '<tr data-mc="'+i+'"><td><input type="checkbox" data-f="on"'+(p.on?" checked":"")+'></td>'+
    '<td>'+esc(p.l)+'</td><td><code>'+esc(p.k)+'</code></td>'+
    '<td><select data-f="d">'+["normal","lognormal","uniforme"].map(function(x){return '<option'+(p.d===x?" selected":"")+'>'+x+'</option>';}).join("")+'</select></td>'+
    '<td><input type="number" step="1" min="0" data-f="cv" value="'+fmt(p.cv*100,0)+'"></td>'+
    '<td>'+fmt(num(state[p.k]),3)+'</td></tr>';
  }).join("")+'</tbody>';
}
document.addEventListener("input",function(ev){
  var tr=ev.target&&ev.target.closest?ev.target.closest("tr[data-mc]"):null;
  if(!tr)return;
  var p=MOD.mc[parseInt(tr.dataset.mc,10)],f=ev.target.dataset.f;
  if(!p||!f)return;
  if(f==="on")p.on=ev.target.checked;
  else if(f==="d")p.d=ev.target.value;
  else if(f==="cv")p.cv=num(ev.target.value)/100;
  saveMOD();
});
function sampleValue(u,base,p){
  var z=normInv(u);
  if(p.d==="uniforme")return base*(1-p.cv)+u*2*base*p.cv;
  if(p.d==="lognormal"){var sg=Math.sqrt(Math.log(1+p.cv*p.cv));return base*Math.exp(sg*z);}
  return base+p.cv*base*z;
}
function buildSample(base,u,params){
  var s=Object.assign({},base);
  for(var j=0;j<params.length;j++){
    var p=params[j];
    var b=num(base[p.k]);
    if(b===0)continue;
    var v=sampleValue(u[j],b,p);
    if(p.k==="rate")v=clamp(v,0,40);
    if(p.k==="etaF")v=clamp(v,50,100);
    if(v<0)v=0;
    s[p.k]=v;
  }
  return s;
}
function setProgress(f){
  var b=document.getElementById("mcBar");
  if(b)b.style.width=(100*clamp(f,0,1)).toFixed(1)+"%";
}
function runMC(n,done){
  var params=MOD.mc.filter(function(p){return p.on;});
  if(!params.length){done(null);return;}
  var profiles={solar:currentSolar(),wind:currentWind()};
  var rng=mulberry32(20261116);
  var U=lhs(n,params.length,rng);
  var out=new Float64Array(n),i=0;
  function step(){
    var t0=performance.now();
    while(i<n&&performance.now()-t0<45){
      try{out[i]=evalFast(buildSample(state,U[i],params),profiles).lcoh;}catch(e){out[i]=NaN;}
      i++;
    }
    setProgress(i/n);
    if(i<n)setTimeout(step,0);
    else done(Array.prototype.slice.call(out).filter(function(v){return isFinite(v);}));
  }
  step();
}
function renderMC(vals){
  if(!vals||!vals.length){msg("Monte Carlo sin resultados válidos.",true);return;}
  var sorted=vals.slice().sort(function(a,b){return a-b;});
  var p10=percentile(sorted,0.10),p50=percentile(sorted,0.50),p90=percentile(sorted,0.90);
  var m=mean(vals),sd=Math.sqrt(variance(vals));
  MOD.mcOut={vals:vals,p10:p10,p50:p50,p90:p90,mean:m,sd:sd};
  document.getElementById("mcStats").innerHTML=[
    metric("LCOH P10 (optimista)",fmt(p10)+" €/kg","10 % de probabilidad de ser menor"),
    metric("LCOH P50 (mediana)",fmt(p50)+" €/kg","valor central"),
    metric("LCOH P90 (conservador)",fmt(p90)+" €/kg","10 % de probabilidad de ser mayor"),
    metric("Media",fmt(m)+" €/kg"),
    metric("Desviación típica",fmt(sd)+" €/kg","CV "+fmt(100*sd/m,1)+" %"),
    metric("Rango P90−P10",fmt(p90-p10)+" €/kg",fmt(100*(p90-p10)/p50,1)+" % de la mediana",(p90-p10)/p50>0.3?"warn":"alt"),
    metric("Muestras válidas",fmt0(vals.length)),
    metric("Prob. LCOH < 4 €/kg",fmt(100*vals.filter(function(v){return v<4;}).length/vals.length,1)+" %")
  ].join("");
  var nb=22,lo=sorted[0],hi=sorted[sorted.length-1],bins=new Array(nb).fill(0);
  var w=(hi-lo)/nb||1;
  vals.forEach(function(v){var b=Math.min(nb-1,Math.floor((v-lo)/w));bins[b]++;});
  var labels=[];for(var i=0;i<nb;i++)labels.push(fmt(lo+w*(i+0.5),2));
  svgBars(document.getElementById("mcHist"),bins,labels,{h:300,dec:0,color:"#11956e"});
  var stepN=Math.max(1,Math.floor(sorted.length/120)),xs=[],ys=[];
  for(var k=0;k<sorted.length;k+=stepN){xs.push(sorted[k]);ys.push(100*(1-k/sorted.length));}
  svgLine(document.getElementById("mcCdf"),[{data:ys,color:"#075e49",w:2}],{h:300,maxY:100,xLabel:function(i2){return fmt(xs[Math.min(i2,xs.length-1)],2);}});
}
document.getElementById("mcRun").addEventListener("click",function(){
  var n=clamp(Math.round(num(document.getElementById("mcN").value)),50,5000);
  document.getElementById("mcMsg").textContent="Ejecutando "+n+" muestras…";
  setProgress(0);
  setTimeout(function(){
    runMC(n,function(vals){
      renderMC(vals);
      document.getElementById("mcMsg").textContent="Monte Carlo completado ("+(vals?vals.length:0)+" muestras válidas).";
      if(MOD.mcOut)msg("Monte Carlo completado. P50 = "+fmt(MOD.mcOut.p50)+" €/kg.");
    });
  },30);
});

/* ======================= 9 · SOBOL ======================= */
function runSobol(N,done){
  var params=MOD.mc.filter(function(p){return p.on;});
  var k=params.length;
  if(!k){done(null);return;}
  var profiles={solar:currentSolar(),wind:currentWind()};
  var rng=mulberry32(777001);
  var A=lhs(N,k,rng),B=lhs(N,k,rng);
  var fA=new Float64Array(N),fB=new Float64Array(N),fAB=[];
  for(var i=0;i<k;i++)fAB.push(new Float64Array(N));
  var jobs=[],j;
  for(j=0;j<N;j++)jobs.push({t:"A",j:j});
  for(j=0;j<N;j++)jobs.push({t:"B",j:j});
  for(i=0;i<k;i++)for(j=0;j<N;j++)jobs.push({t:"AB",i:i,j:j});
  var idx=0;
  function step(){
    var t0=performance.now();
    while(idx<jobs.length&&performance.now()-t0<45){
      var job=jobs[idx],u;
      if(job.t==="A")u=A[job.j];
      else if(job.t==="B")u=B[job.j];
      else{u=A[job.j].slice();u[job.i]=B[job.j][job.i];}
      var v;
      try{v=evalFast(buildSample(state,u,params),profiles).lcoh;}catch(e){v=NaN;}
      if(job.t==="A")fA[job.j]=v;else if(job.t==="B")fB[job.j]=v;else fAB[job.i][job.j]=v;
      idx++;
    }
    setProgress(idx/jobs.length);
    if(idx<jobs.length)setTimeout(step,0);
    else{
      var all=Array.prototype.slice.call(fA).concat(Array.prototype.slice.call(fB)).filter(function(x){return isFinite(x);});
      var varY=variance(all);
      var res=[];
      for(var i2=0;i2<k;i2++){
        var s1=0,st=0;
        for(var j2=0;j2<N;j2++){
          if(!isFinite(fA[j2])||!isFinite(fB[j2])||!isFinite(fAB[i2][j2]))continue;
          s1+=fB[j2]*(fAB[i2][j2]-fA[j2]);
          st+=Math.pow(fA[j2]-fAB[i2][j2],2);
        }
        s1/=(N*varY);st/=(2*N*varY);
        res.push({k:params[i2].k,l:params[i2].l,S1:Math.max(0,s1),ST:Math.max(0,st)});
      }
      res.sort(function(a,b){return b.ST-a.ST;});
      done(res);
    }
  }
  step();
}
function renderSobol(res){
  if(!res||!res.length){msg("Sobol sin resultados.",true);return;}
  MOD.sobolOut=res;
  var sumS1=res.reduce(function(t,x){return t+x.S1;},0);
  document.getElementById("sobolTable").innerHTML=
  '<thead><tr><th>Parámetro</th><th>S₁ (primer orden)</th><th>S_Ti (total)</th><th>Interacción</th><th></th></tr></thead><tbody>'+
  res.map(function(x){
    var inter=x.ST-x.S1;
    return '<tr><td>'+esc(x.l)+'</td><td>'+fmt(x.S1,3)+'</td><td>'+fmt(x.ST,3)+'</td><td>'+fmt(inter,3)+'</td>'+
    '<td style="width:180px"><span style="display:inline-block;height:9px;border-radius:4px;background:#11956e;width:'+(100*clamp(x.ST,0,1)).toFixed(0)+'%;margin-right:4px"></span>'+
    '<span style="display:inline-block;height:9px;border-radius:4px;background:#e3a31c;width:'+(100*clamp(x.S1,0,1)).toFixed(0)+'%"></span></td></tr>';
  }).join("")+
  '</tbody><tfoot><tr><td>Suma S₁</td><td>'+fmt(sumS1,3)+'</td><td>—</td><td>—</td><td>Interacción global: '+fmt(1-sumS1,3)+'</td></tr></tfoot>';
  svgBars(document.getElementById("sobolChart"),res.map(function(x){return x.ST;}),res.map(function(x){return x.k;}),{h:320,dec:2,color:"#075e49",maxY:1});
}
document.getElementById("sobolRun").addEventListener("click",function(){
  var N=clamp(Math.round(num(document.getElementById("mcN").value)/3),32,256);
  var k=MOD.mc.filter(function(p){return p.on;}).length;
  document.getElementById("mcMsg").textContent="Ejecutando Sobol: "+N+" × ("+k+"+2) = "+(N*(k+2))+" evaluaciones…";
  setProgress(0);
  setTimeout(function(){
    runSobol(N,function(res){
      renderSobol(res);
      document.getElementById("mcMsg").textContent="Sobol completado.";
      msg("Índices de Sobol calculados.");
    });
  },30);
});

/* ======================= 10 · PERSISTENCIA Y ARRANQUE ======================= */
function saveMOD(){
  kvPut("h2mod",{calib:MOD.calib,mc:MOD.mc,valCases:MOD.valCases}).catch(function(){});
}
function start(){
  renderForm();
  renderValCases();
  renderMcParams();
  /* Arreglo B: fuerza un recálculo con el motor ya parcheado */
  try{recalc();}catch(e){if(window.console)console.warn("[h2modules] recalc inicial",e);}
  kvGet("h2mod").then(function(saved){
    if(saved){
      if(saved.calib)MOD.calib=saved.calib;
      if(saved.mc)MOD.mc=saved.mc;
      if(saved.valCases)MOD.valCases=saved.valCases;
      renderValCases();renderMcParams();
    }
    runValidation();
  }).catch(function(){runValidation();});
  if(window.result)renderCycling(window.result);
  if(window.console)console.log("[h2modules] "+VERSION+" cargado correctamente.");
}
/* Arreglo A: espera a que init() haya terminado de cargar el proyecto */
var bootTries=0;
function boot(){
  bootTries++;
  var ok=window.simulate&&window.SCHEMA&&window.state&&window.derive;
  var listo=ok&&(document.getElementById("projSelect")||bootTries>40);
  if(!listo){setTimeout(boot,80);return;}
  try{start();}catch(e){if(window.console)console.error("[h2modules]",e);}
}
boot();
})();
