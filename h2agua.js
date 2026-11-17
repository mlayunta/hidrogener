/* =====================================================================
   H2 VERDE · Módulo de agua y oxígeno · v1 · Miguel Ángel Layunta López
   - Consumo de agua desmineralizada, energía de tratamiento y coste
   - Oxígeno como coproducto: producción, fracción aprovechable e ingreso
   - Efecto neto sobre el LCOH, con desglose tipo cascada
   - Corrige además el doble cómputo del CAPEX en TIR y retorno
   Instalación: añadir <script src="./h2agua.js"></script> antes de </body>
   ===================================================================== */
(function () {
"use strict";

var VERSION="v1";

/* ======================= UTILIDADES ======================= */
function kvGet(key){
  if(typeof idb!=="function")return Promise.resolve(null);
  return idb().then(function(db){return new Promise(function(res){var q=db.transaction("kv","readonly").objectStore("kv").get(key);q.onsuccess=function(){res(q.result);};q.onerror=function(){res(null);};});}).catch(function(){return null;});
}
function kvPut(key,val){
  if(typeof idb!=="function")return Promise.resolve();
  return idb().then(function(db){return new Promise(function(res){var tx=db.transaction("kv","readwrite");tx.objectStore("kv").put(val,key);tx.oncomplete=function(){res();};tx.onerror=function(){res();};});}).catch(function(){});
}
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
function bar(pct,color){
  return '<span style="display:inline-block;height:9px;border-radius:4px;background:'+color+';width:'+Math.max(0,Math.min(100,pct)).toFixed(1)+'%"></span>';
}

/* ======================= ESQUEMA AMPLIADO ======================= */
SCHEMA.push({g:"9 · Agua y oxígeno",f:[
  ["waterOn","Contabilizar agua desmineralizada","bool",true],
  ["waterLperKg","Consumo de agua desmineralizada","num",12,5,40,0.5,"L/kg H₂","Estequiométrico: 9 L/kg. Con purgas y regeneración de resinas: 10–15 L/kg."],
  ["waterPrice","Coste del agua de aporte","num",1.5,0,20,0.05,"€/m³","Red industrial 1–3. Pozo 0,3–1. Regenerada 0,5–1,5. Desalada 1–3."],
  ["waterTreatKwh","Energía de tratamiento (ósmosis + EDI)","num",1.0,0,10,0.1,"kWh/m³"],
  ["o2On","Contabilizar oxígeno como coproducto","bool",true],
  ["o2PerKg","Producción de oxígeno","num",8.0,0,12,0.1,"kg O₂/kg H₂","Estequiométrico: 8 kg O₂ por kg de H₂."],
  ["o2Price","Precio de venta del oxígeno","num",80,0,600,5,"€/t","Industrial en gas: 50–150. Líquido o medicinal: 200–500."],
  ["o2Capture","Fracción aprovechable","num",70,0,100,5,"%","Exige purificación, secado, compresión y un consumidor cercano."]
]});
DEFAULTS.waterOn=true;DEFAULTS.waterLperKg=12;DEFAULTS.waterPrice=1.5;DEFAULTS.waterTreatKwh=1.0;
DEFAULTS.o2On=true;DEFAULTS.o2PerKg=8.0;DEFAULTS.o2Price=80;DEFAULTS.o2Capture=70;
["waterOn","waterLperKg","waterPrice","waterTreatKwh","o2On","o2PerKg","o2Price","o2Capture"].forEach(function(k){
  if(state[k]===undefined)state[k]=DEFAULTS[k];
});

/* ======================= PARCHE DE economics ======================= */
var _economics=window.economics;
window.economics=function(s,perYear){
  var e=_economics(s,perYear);
  try{
    var r=num(s.rate)/100,life=perYear.length,y;
    var waterNPV=0,o2NPV=0,waterTotal=0,o2Total=0,waterM3=0,o2T=0,kgTotal=0,delTotal=0;
    var cf=[];
    for(y=1;y<=life;y++){
      var p=perYear[y-1];
      var vol=p.kg*num(s.waterLperKg)/1000;                                   /* m³ */
      var wc=s.waterOn?(vol*num(s.waterPrice)+vol*num(s.waterTreatKwh)*num(s.elecPrice))*Math.pow(1+num(s.infl)/100,y-1):0;
      var o2kg=p.delivered*num(s.o2PerKg)*clamp(num(s.o2Capture)/100,0,1);
      var o2rev=s.o2On?(o2kg/1000*num(s.o2Price))*Math.pow(1+num(s.infl)/100,y-1):0;
      waterNPV+=wc/Math.pow(1+r,y);
      o2NPV+=o2rev/Math.pow(1+r,y);
      waterTotal+=wc;o2Total+=o2rev;waterM3+=vol;o2T+=o2kg/1000;
      kgTotal+=p.kg;delTotal+=p.delivered;
      var rev=p.delivered*num(s.h2Price)*Math.pow(1+num(s.infl)/100,y-1);
      /* e.rows[y-1].cost ya incluye el CAPEX en el año 1: no se resta otra vez */
      cf.push(rev+o2rev-e.rows[y-1].cost-wc);
    }
    var npvRev=e.npv+e.npvCost;
    var npvCostAdj=e.npvCost+waterNPV;
    var npvRevAdj=npvRev+o2NPV;
    e.lcohBase=e.lcoh;
    e.lcoh=e.npvKg>0?npvCostAdj/e.npvKg:NaN;
    e.lcohNoCap=e.npvKg>0?(npvCostAdj-e.capex.total)/e.npvKg:NaN;
    e.npv=npvRevAdj-npvCostAdj;
    e.lcohWater=e.npvKg>0?waterNPV/e.npvKg:NaN;
    e.lcohO2=e.npvKg>0?o2NPV/e.npvKg:NaN;
    e.waterNPV=waterNPV;e.o2NPV=o2NPV;
    e.waterTotal=waterTotal;e.o2Total=o2Total;
    e.waterM3=waterM3;e.o2T=o2T;
    e.waterPerKg=kgTotal>0?waterM3*1000/kgTotal:NaN;
    e.waterCostPerKg=kgTotal>0?waterTotal/kgTotal:NaN;
    e.o2PerKgReal=delTotal>0?o2T*1000/delTotal:NaN;
    e.o2RevPerKg=delTotal>0?o2Total/delTotal:NaN;
    /* TIR y retorno recalculados sin el doble cómputo del CAPEX */
    cf[0]-=0;
    function npvAt(k){var t=0;for(var i=0;i<cf.length;i++)t+=cf[i]/Math.pow(1+k,i+1);return t;}
    var irr=NaN,lo=-0.9,hi=1.5;
    if(npvAt(lo)>0&&npvAt(hi)<0){for(var i2=0;i2<90;i2++){var m=(lo+hi)/2;if(npvAt(m)>0)lo=m;else hi=m;}irr=(lo+hi)/2;}
    e.irr=irr;
    var acc=-e.capex.total,pb=NaN;
    for(var i3=0;i3<cf.length;i3++){acc+=cf[i3];if(acc>=0&&!isFinite(pb))pb=i3+1;}
    e.payback=pb;
  }catch(err){if(window.console)console.warn("[h2agua] economics",err);}
  return e;
};

/* ======================= PARCHE DE recalc ======================= */
var _recalc=window.recalc;
window.recalc=function(){
  _recalc();
  try{if(window.result)renderAgua(window.result);}catch(e){if(window.console)console.warn("[h2agua] render",e);}
};

/* ======================= UI ======================= */
addTab("agua","11 · Agua y O₂",
'<div class="card"><h2>Agua y oxígeno</h2>'+
'<div class="note info">El <strong>LCOH de la pestaña 2 ya incluye</strong> el coste del agua y el ingreso por oxígeno. Aquí se desglosa el efecto de cada uno.</div>'+
'<div id="aguaKpis" class="metrics"></div></div>'+
'<div class="card"><h2>Desglose del LCOH</h2><div class="scroll"><table id="aguaCascade"></table></div>'+
'<p style="color:var(--muted);font-size:.82rem">Los valores están nivelados con la misma tasa de descuento y la misma producción descontada que el LCOH principal, por lo que la cascada cierra exactamente.</p></div>'+
'<div class="two">'+
'<div class="card"><h2>Balance de agua</h2><div class="scroll"><table id="aguaTabla"></table></div></div>'+
'<div class="card"><h2>Balance de oxígeno</h2><div class="scroll"><table id="aguaO2"></table></div></div>'+
'</div>'+
'<div class="card"><h2>Notas de interpretación</h2><ul style="font-size:.87rem;line-height:1.6">'+
'<li><strong>Agua.</strong> El consumo estequiométrico es 9 L/kg de H₂. El valor real incluye purgas, regeneración de resinas y agua de enfriamiento evaporativo en AEL, que puede ser varias veces mayor. El coste del agua rara vez supera 0,05 €/kg; su relevancia es sobre todo de <em>huella hídrica y permisos</em>, no económica.</li>'+
'<li><strong>Oxígeno.</strong> Aquí está el dinero. A 8 kg O₂/kg H₂ y 80 €/t, el ingreso potencial es de 0,64 €/kg de H₂: puede mover el LCOH más de un 10 %. Pero solo se materializa con un consumidor cercano (acería, cemento, vidrio, oxicombustión, depuradora, piscifactoría) y tras purificar, secar y comprimir.</li>'+
'<li><strong>Pureza.</strong> El O₂ de electrólisis sale con 0,5–2 % de H₂ y humedad saturada. Para uso medicinal o de corte requiere purificación adicional; para oxicombustión industrial suele bastar con secado y compresión.</li>'+
'<li><strong>Prudencia.</strong> La fracción aprovechable por defecto es del 70 %. Si no tiene un comprador identificado, póngala a 0: es la hipótesis honesta.</li>'+
'</ul></div>');

function renderAgua(r){
  var e=r.econ;
  if(!e||e.lcohBase===undefined)return;
  var base=e.lcohBase,w=e.lcohWater||0,o=e.lcohO2||0,net=e.lcoh;
  var delta=net-base;
  var k=document.getElementById("aguaKpis");
  if(!k)return;
  k.innerHTML=[
    metric("Agua total",fmt(e.waterM3,0)+" m³/año"),
    metric("Agua por kg de H₂",fmt(e.waterPerKg,1)+" L/kg","estequiométrico: 9,0"),
    metric("Coste del agua",fmt(e.waterCostPerKg,4)+" €/kg",fmt(e.waterTotal,0)+" €/año"),
    metric("O₂ producido",fmt(e.o2T,1)+" t/año",fmt(e.o2PerKgReal,2)+" kg/kg H₂"),
    metric("O₂ aprovechable",fmt(e.o2T*clamp(num(state.o2Capture)/100,0,1),1)+" t/año",fmt(num(state.o2Capture),0)+" % del total"),
    metric("Ingreso por O₂",fmt(e.o2RevPerKg,4)+" €/kg",fmt(e.o2Total,0)+" €/año"),
    metric("Efecto neto en LCOH",(delta<=0?"":"+")+fmt(delta,3)+" €/kg",delta<=0?"el coproducto compensa el agua":"el agua pesa más que el oxígeno",delta<=0?"alt":"warn"),
    metric("LCOH neto",fmt(net)+" €/kg","base sin agua ni O₂: "+fmt(base)+" €/kg")
  ].join("");
  var maxAbs=Math.max(Math.abs(base),Math.abs(w),Math.abs(o),Math.abs(net),1e-9);
  var rows=[
    ["LCOH base (sin agua ni oxígeno)",base,"#5a746b",base/maxAbs*100],
    ["+ Coste del agua y su tratamiento",w,"#c58fd6",w/maxAbs*100],
    ["− Ingreso por oxígeno",-o,"#34ad70",o/maxAbs*100],
    ["= LCOH neto",net,"#075e49",net/maxAbs*100]
  ];
  document.getElementById("aguaCascade").innerHTML=
  '<thead><tr><th>Concepto</th><th>€/kg</th><th>% del LCOH base</th><th></th></tr></thead><tbody>'+
  rows.map(function(x){
    return '<tr><td>'+esc(x[0])+'</td><td>'+fmt(x[1],4)+'</td><td>'+fmt(base>0?100*x[1]/base:NaN,2)+' %</td>'+
    '<td style="width:200px">'+bar(x[3],x[2])+'</td></tr>';
  }).join("")+'</tbody>';
  var vol=e.waterM3,kgTot=e.waterPerKg>0?vol*1000/e.waterPerKg:0;
  document.getElementById("aguaTabla").innerHTML=
  '<thead><tr><th>Concepto</th><th>Valor</th></tr></thead><tbody>'+
  '<tr><td>H₂ producido</td><td>'+fmt0(kgTot)+' kg/año</td></tr>'+
  '<tr><td>Agua desmineralizada</td><td>'+fmt(vol,0)+' m³/año</td></tr>'+
  '<tr><td>Consumo específico</td><td>'+fmt(e.waterPerKg,2)+' L/kg H₂</td></tr>'+
  '<tr><td>Exceso sobre el estequiométrico</td><td>'+fmt(e.waterPerKg-9,2)+' L/kg ('+fmt(100*(e.waterPerKg-9)/9,0)+' %)</td></tr>'+
  '<tr><td>Energía de tratamiento</td><td>'+fmt(vol*num(state.waterTreatKwh)/1000,1)+' MWh/año</td></tr>'+
  '<tr><td>Coste del agua de aporte</td><td>'+fmt(vol*num(state.waterPrice),0)+' €/año</td></tr>'+
  '<tr><td>Coste de la energía de tratamiento</td><td>'+fmt(vol*num(state.waterTreatKwh)*num(state.elecPrice),0)+' €/año</td></tr>'+
  '<tr><td><strong>Coste total del agua</strong></td><td><strong>'+fmt(e.waterTotal,0)+' €/año</strong></td></tr>'+
  '<tr><td>Huella hídrica por kg de H₂</td><td>'+fmt(e.waterPerKg,1)+' L/kg</td></tr>'+
  '</tbody>';
  var o2Tot=e.o2T,o2Cap=o2Tot*clamp(num(state.o2Capture)/100,0,1);
  document.getElementById("aguaO2").innerHTML=
  '<thead><tr><th>Concepto</th><th>Valor</th></tr></thead><tbody>'+
  '<tr><td>O₂ estequiométrico</td><td>8,00 kg/kg H₂</td></tr>'+
  '<tr><td>O₂ producido</td><td>'+fmt(o2Tot,1)+' t/año</td></tr>'+
  '<tr><td>Fracción aprovechable</td><td>'+fmt(num(state.o2Capture),0)+' %</td></tr>'+
  '<tr><td>O₂ comercializable</td><td>'+fmt(o2Cap,1)+' t/año</td></tr>'+
  '<tr><td>Precio de venta</td><td>'+fmt(num(state.o2Price),0)+' €/t</td></tr>'+
  '<tr><td>Ingreso anual</td><td>'+fmt(e.o2Total,0)+' €/año</td></tr>'+
  '<tr><td>Ingreso por kg de H₂</td><td>'+fmt(e.o2RevPerKg,4)+' €/kg</td></tr>'+
  '<tr><td><strong>Crédito nivelado sobre el LCOH</strong></td><td><strong>−'+fmt(e.lcohO2,4)+' €/kg</strong></td></tr>'+
  '</tbody>';
}

/* ======================= ARRANQUE ======================= */
function start(){
  renderForm();
  try{recalc();}catch(e){if(window.console)console.warn("[h2agua] recalc",e);}
  if(window.result)renderAgua(window.result);
  if(window.console)console.log("[h2agua] "+VERSION+" cargado correctamente.");
}
var bootTries=0;
function boot(){
  bootTries++;
  var ok=window.simulate&&window.SCHEMA&&window.state&&window.derive&&window.economics;
  var listo=ok&&(document.getElementById("projSelect")||bootTries>40);
  if(!listo){setTimeout(boot,80);return;}
  try{start();}catch(e){if(window.console)console.error("[h2agua]",e);}
}
boot();
})();
