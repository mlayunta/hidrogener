/* =====================================================================
   H2 VERDE · Módulo de gemelo digital · v1
   - Importación de datos medidos en operación (CSV flexible)
   - Comparación previsto contra medido: agregados, curvas de duración
     y nube de puntos horaria, sin necesidad de alinear fechas
   - Métricas de error: MAPE, RMSE, sesgo y coeficiente de determinación
   - Tendencia de degradación real estimada a partir del consumo medido
   Instalación: añadir <script src="./h2gemelo.js"></script> antes de </body>
   ===================================================================== */
(function () {
"use strict";

var VERSION="v1";
var GEM={med:null,res:null};

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
function setMsg(id,txt,bad){
  var el=document.getElementById(id);
  if(!el)return;
  el.textContent=txt;el.style.color=bad?"#c0392b":"var(--muted)";
}
function mean(a){var s=0,i;for(i=0;i<a.length;i++)s+=a[i];return a.length?s/a.length:0;}
function stdev(a){var m=mean(a),s=0,i;for(i=0;i<a.length;i++)s+=(a[i]-m)*(a[i]-m);return a.length>1?Math.sqrt(s/(a.length-1)):0;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* ======================= PARSER FLEXIBLE ======================= */
function parseMeasured(text){
  var lines=text.split(/\r?\n/).filter(function(l){return l.trim().length;});
  if(lines.length<10)return null;
  var sep=lines[0].indexOf(";")>=0?";":",";
  var head=lines[0].split(sep).map(function(x){return x.trim().toLowerCase().replace(/"/g,"");});
  var iT=-1,iKg=-1,iKwh=-1;
  for(var j=0;j<head.length;j++){
    var h=head[j];
    if(iT<0&&/time|fecha|date|hora|timestamp|periodo/.test(h))iT=j;
    if(iKg<0&&/(kg|h2|hidr|producc|generac)/.test(h))iKg=j;
    if(iKwh<0&&/(kwh|energ|consum|electric|mwh)/.test(h))iKwh=j;
  }
  var start=1;
  if(iKg<0&&iKwh<0){
    /* sin cabecera reconocible: asume timestamp, kg, kWh */
    iT=0;iKg=1;iKwh=2;start=0;
    if(lines[0].split(sep).length<3)return null;
  }
  var kg=[],kwh=[];
  for(var i=start;i<lines.length;i++){
    var c=lines[i].split(sep);
    var vk=iKg>=0?parseFloat(c[iKg]):0;
    var ve=iKwh>=0?parseFloat(c[iKwh]):0;
    if(!isFinite(vk))vk=0;
    if(!isFinite(ve))ve=0;
    if(vk<0)vk=0;
    if(ve<0)ve=0;
    kg.push(vk);kwh.push(ve);
  }
  if(kg.length<10)return null;
  return {kg:Float64Array.from(kg),kwh:Float64Array.from(kwh),n:kg.length};
}

/* ======================= COMPARACIÓN ======================= */
function modelHourly(){
  var r=window.result;
  if(!r||!r.y0||!r.y0.r||!r.y0.r.H)return null;
  var H=r.y0.r.H,P=r.y0.P;
  var n=H.kg.length,kg=new Float64Array(n),kwh=new Float64Array(n);
  for(var i=0;i<n;i++){
    kg[i]=H.kg[i];
    kwh[i]=H.stack[i]*(1+P.bop)/P.rect;
  }
  return {kg:kg,kwh:kwh,n:n};
}
function sortedDesc(a){
  var b=Array.prototype.slice.call(a);
  b.sort(function(x,y){return y-x;});
  return b;
}
function compare(){
  var m=GEM.med,mo=modelHourly();
  if(!m||!mo){setMsg("gemMsg","Faltan datos medidos o no hay simulación disponible.",true);return;}
  var n=Math.min(m.n,mo.n);
  var kgM=0,kwhM=0,kgP=0,kwhP=0,opM=0,opP=0,i;
  for(i=0;i<n;i++){
    kgM+=m.kg[i];kwhM+=m.kwh[i];kgP+=mo.kg[i];kwhP+=mo.kwh[i];
    if(m.kg[i]>0)opM++;
    if(mo.kg[i]>0)opP++;
  }
  var consM=kgM>0?kwhM/kgM:NaN,consP=kgP>0?kwhP/kgP:NaN;
  /* nube de puntos y errores sobre las horas con producción */
  var pairs=[],errs=[],absE=[],se=[];
  for(i=0;i<n;i++){
    if(m.kg[i]<=0&&mo.kg[i]<=0)continue;
    pairs.push([mo.kg[i],m.kg[i]]);
    var e=m.kg[i]-mo.kg[i];
    errs.push(e);absE.push(Math.abs(e));se.push(e*e);
  }
  var mape=0,cnt=0;
  for(i=0;i<n;i++){
    if(m.kg[i]>0.01){mape+=Math.abs(m.kg[i]-mo.kg[i])/m.kg[i];cnt++;}
  }
  mape=cnt?100*mape/cnt:NaN;
  var rmse=se.length?Math.sqrt(mean(se)):NaN;
  var bias=errs.length?mean(errs):NaN;
  var sdM=stdev(Array.prototype.slice.call(m.kg,0,n));
  var r2=sdM>0?1-(rmse*rmse)/(sdM*sdM):NaN;
  /* tendencia de degradación sobre el consumo específico medido */
  var degRate=NaN;
  if(n>=720){
    var xs=[],ys=[],acc=0,accN=0;
    for(i=0;i<n;i++){
      if(m.kg[i]>0.01){acc+=m.kwh[i]/m.kg[i];accN++;}
      if((i+1)%24===0&&accN>0){xs.push((i+1)/24);ys.push(acc/accN);acc=0;accN=0;}
    }
    if(xs.length>10){
      var mx=mean(xs),my=mean(ys),sxy=0,sxx=0;
      for(i=0;i<xs.length;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)*(xs[i]-mx);}
      var slope=sxx>0?sxy/sxx:0;                 /* (kWh/kg) por día */
      var Vref=1.75,consRef=consM;
      degRate=Vref*(slope/consRef)*1e6/24;       /* µV/h */
    }
  }
  GEM.res={n:n,kgM:kgM,kwhM:kwhM,kgP:kgP,kwhP:kwhP,consM:consM,consP:consP,
    opM:opM,opP:opP,mape:mape,rmse:rmse,bias:bias,r2:r2,degRate:degRate,pairs:pairs};
  renderGemelo();
}
function renderGemelo(){
  var g=GEM.res;
  if(!g)return;
  var dCons=(g.consM-g.consP)/g.consP*100;
  var dKg=(g.kgM-g.kgP)/g.kgP*100;
  document.getElementById("gemKpis").innerHTML=[
    metric("Horas comparadas",fmt0(g.n)),
    metric("H₂ medido",fmt0(g.kgM)+" kg",fmt0(100*g.kgM/g.kgP-100,1)+" % frente al modelo"),
    metric("Consumo específico medido",fmt(g.consM,2)+" kWh/kg","modelo: "+fmt(g.consP,2)+" kWh/kg"),
    metric("Desviación del consumo",fmt(dCons,1)+" %",Math.abs(dCons)<=3?"modelo calibrado":"requiere calibración",Math.abs(dCons)<=3?"alt":(Math.abs(dCons)<=8?"warn":"bad")),
    metric("MAPE horaria",fmt(g.mape,1)+" %","sobre horas con producción",g.mape<=15?"alt":(g.mape<=30?"warn":"bad")),
    metric("RMSE horario",fmt(g.rmse,3)+" kg/h"),
    metric("Sesgo",fmt(g.bias,3)+" kg/h",g.bias>0?"el modelo subestima":"el modelo sobreestima",g.bias>0?"warn":"alt"),
    metric("Coeficiente de determinación",fmt(g.r2,3),"1 = ajuste perfecto",g.r2>0.8?"alt":(g.r2>0.5?"warn":"bad")),
    metric("Horas en operación",fmt0(g.opM)+" medidas",fmt0(g.opP)+" modeladas"),
    metric("Degradación real estimada",isFinite(g.degRate)?fmt(g.degRate,2)+" µV/h":"—","a partir de la tendencia del consumo medido")
  ].join("");
  var dm=sortedDesc(Array.prototype.slice.call(GEM.med.kg,0,g.n));
  var dp=sortedDesc(Array.prototype.slice.call(modelHourly().kg,0,g.n));
  var step=Math.max(1,Math.floor(g.n/200)),xs=[],ysM=[],ysP=[];
  for(var i=0;i<g.n;i+=step){xs.push(i);ysM.push(dm[i]);ysP.push(dp[i]);}
  svgLine(document.getElementById("gemDur"),[
    {data:ysM,color:"#c0392b",w:2},
    {data:ysP,color:"#11956e",w:2}
  ],{h:300,xLabel:function(j){return "h"+xs[Math.min(j,xs.length-1)];}});
  var mx=0;
  for(var k=0;k<g.pairs.length;k++){if(g.pairs[k][0]>mx)mx=g.pairs[k][0];if(g.pairs[k][1]>mx)mx=g.pairs[k][1];}
  var pts="";
  for(var p=0;p<g.pairs.length;p+=Math.max(1,Math.floor(g.pairs.length/1500))){
    var px=60+(g.pairs[p][0]/Math.max(mx,1e-9))*880,py=280-(g.pairs[p][1]/Math.max(mx,1e-9))*240;
    pts+='<circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="2.2" fill="#4a7fd4" opacity="0.55"/>';
  }
  document.getElementById("gemScatter").innerHTML=
    '<line x1="60" y1="280" x2="940" y2="280" stroke="#b9cec5"/>'+
    '<line x1="60" y1="40" x2="60" y2="280" stroke="#b9cec5"/>'+
    '<line x1="60" y1="280" x2="940" y2="40" stroke="#c0392b" stroke-dasharray="5 4" stroke-width="1.2"/>'+
    pts+
    '<text x="500" y="298" font-size="11" fill="#7b918a" text-anchor="middle">modelo (kg/h)</text>'+
    '<text x="18" y="160" font-size="11" fill="#7b918a" text-anchor="middle" transform="rotate(-90 18 160)">medido (kg/h)</text>';
}
function exampleData(){
  var mo=modelHourly();
  if(!mo)return null;
  var rng=mulberry32(31337),n=Math.min(8760,mo.n);
  var kg=new Float64Array(n),kwh=new Float64Array(n);
  for(var i=0;i<n;i++){
    var drift=1+0.00002*i;                       /* degradación simulada */
    kg[i]=Math.max(0,mo.kg[i]*(1+(rng()-0.5)*0.10)/drift);
    kwh[i]=mo.kwh[i]*drift*(1+(rng()-0.5)*0.04);
  }
  return {kg:kg,kwh:kwh,n:n};
}

/* ======================= UI ======================= */
addTab("gemelo","14 · Gemelo digital",
'<div class="card"><h2>Gemelo digital · previsto contra medido</h2>'+
'<p style="color:var(--muted);font-size:.87rem">Importa el histórico horario de operación de la planta y compáralo con lo que predice el modelo con la misma configuración. La comparación usa <strong>curvas de duración</strong>, por lo que no hace falta alinear fechas ni husos horarios.</p>'+
'<div class="toolbar"><button class="btn" id="gemCsvBtn">Importar CSV de operación</button>'+
'<input type="file" id="gemCsv" accept=".csv,.txt" hidden>'+
'<button class="btn ghost" id="gemDemo">Generar datos de ejemplo</button>'+
'<button class="btn ghost" id="gemClear">Limpiar</button>'+
'<span id="gemMsg" style="color:var(--muted);font-size:.83rem"></span></div>'+
'<div class="note info">Formato admitido: CSV con cabecera. Se detectan automáticamente las columnas de fecha, producción de H₂ (kg) y consumo eléctrico (kWh). Si no hay cabecera, se asume el orden <em>fecha, kg, kWh</em>.</div>'+
'<div id="gemKpis" class="metrics"></div></div>'+
'<div class="two">'+
'<div class="card"><h2>Curvas de duración</h2>'+
'<div class="scroll"><svg id="gemDur" class="chart" viewBox="0 0 1000 300" role="img" aria-label="Curvas de duración"></svg></div>'+
'<p style="color:var(--muted);font-size:.82rem"><span style="color:#c0392b">■</span> medido &nbsp; <span style="color:#11956e">■</span> modelo. Las horas están ordenadas de mayor a menor producción: si las curvas se separan por la cola derecha, el modelo sobrestima las horas de baja carga.</p></div>'+
'<div class="card"><h2>Nube de puntos horaria</h2>'+
'<div class="scroll"><svg id="gemScatter" class="chart" viewBox="0 0 1000 320" role="img" aria-label="Nube de puntos"></svg></div>'+
'<p style="color:var(--muted);font-size:.82rem">La línea roja es la identidad. La nube se estrecha hacia arriba si el modelo acierta a plena carga y falla en carga parcial.</p></div>'+
'</div>'+
'<div class="card"><h2>Diagnóstico</h2><div id="gemDiag"></div></div>');

document.getElementById("gemCsvBtn").addEventListener("click",function(){document.getElementById("gemCsv").click();});
document.getElementById("gemCsv").addEventListener("change",function(ev){
  var f=ev.target.files&&ev.target.files[0];
  if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    var m=parseMeasured(String(rd.result));
    if(!m){setMsg("gemMsg","No se reconoce el formato del CSV.",true);return;}
    GEM.med=m;
    setMsg("gemMsg","Cargadas "+fmt0(m.n)+" horas de operación.");
    compare();
  };
  rd.readAsText(f);
});
document.getElementById("gemDemo").addEventListener("click",function(){
  var d=exampleData();
  if(!d){setMsg("gemMsg","No hay simulación disponible para generar el ejemplo.",true);return;}
  GEM.med=d;
  setMsg("gemMsg","Datos de ejemplo generados con ruido del 10 % y una deriva de degradación conocida.");
  compare();
});
document.getElementById("gemClear").addEventListener("click",function(){
  GEM.med=null;GEM.res=null;
  ["gemKpis","gemDur","gemScatter","gemDiag"].forEach(function(id){var e=document.getElementById(id);if(e)e.innerHTML="";});
  setMsg("gemMsg","Datos limpiados.");
});
function renderDiag(){
  var g=GEM.res;
  if(!g)return;
  var d=document.getElementById("gemDiag");
  if(!d)return;
  var items=[];
  var dCons=(g.consM-g.consP)/g.consP*100;
  if(Math.abs(dCons)<=3)items.push(["ok","El consumo específico medido coincide con el modelo dentro del 3 %. La calibración electroquímica es válida."]);
  else if(dCons>0)items.push(["warn","La planta consume un "+fmt(dCons,1)+" % más de lo previsto. Causas habituales: ASR real mayor por envejecimiento, temperatura de operación inferior a la supuesta, o consumo de auxiliares no contabilizado. Prueba a subir el ASR en el formulario hasta cerrar la brecha."]);
  else items.push(["warn","La planta consume un "+fmt(-dCons,1)+" % menos de lo previsto. El modelo es conservador: revisa el ASR y la eficiencia del rectificador."]);
  if(g.mape>30)items.push(["bad","El MAPE horario supera el 30 %. El modelo reproduce bien los agregados pero no el patrón horario: revisa el perfil de recurso o el despacho."]);
  if(g.r2<0.5)items.push(["warn","El coeficiente de determinación es bajo. La dispersión horaria no está siendo capturada por el modelo."]);
  if(isFinite(g.degRate)){
    var expected=num(state.degRate);
    if(g.degRate>expected*1.5)items.push(["bad","La degradación real estimada ("+fmt(g.degRate,2)+" µV/h) supera en más de un 50 % la supuesta ("+fmt(expected,2)+" µV/h). El stack envejece más rápido de lo previsto: revisa el ciclado y la calidad del agua."]);
    else if(g.degRate<expected*0.5)items.push(["ok","La degradación real ("+fmt(g.degRate,2)+" µV/h) es inferior a la supuesta ("+fmt(expected,2)+" µV/h). Hay margen para relajar la provisión."]);
    else items.push(["ok","La degradación real estimada ("+fmt(g.degRate,2)+" µV/h) es coherente con la hipótesis del modelo ("+fmt(expected,2)+" µV/h)."]);
  }
  if(g.opM>0&&g.opP>0){
    var dOp=100*(g.opM-g.opP)/g.opP;
    if(Math.abs(dOp)>15)items.push(["warn","Las horas en operación difieren un "+fmt(dOp,1)+" %: el modelo predice "+fmt0(g.opP)+" h y la planta registra "+fmt0(g.opM)+" h. Revisa la disponibilidad y los tiempos de arranque."]);
  }
  d.innerHTML=items.map(function(x){return '<div class="note '+x[0]+'" style="margin-bottom:8px">'+x[1]+'</div>';}).join("");
}
var _compare=compare;
compare=function(){_compare();renderDiag();};

/* ======================= ARRANQUE ======================= */
function start(){
  if(window.console)console.log("[h2gemelo] "+VERSION+" cargado correctamente.");
}
var bootTries=0;
function boot(){
  bootTries++;
  var ok=window.simulate&&window.SCHEMA&&window.state&&window.derive&&window.svgLine;
  var listo=ok&&(document.getElementById("projSelect")||bootTries>40);
  if(!listo){setTimeout(boot,80);return;}
  try{start();}catch(e){if(window.console)console.error("[h2gemelo]",e);}
}
boot();
})();
