/* =====================================================================
   H2 VERDE · Módulo de datos reales · v1
   - Descarga del recurso solar horario desde PVGIS (JRC, Comisión Europea)
   - Importación del CSV de PVGIS como alternativa sin conexión
   - Perfil horario de precios: importación CSV o modelo sintético
   - Precio efectivo ponderado por la importación real de red
   Instalación: añadir <script src="./h2datos.js"></script> antes de </body>
   ===================================================================== */
(function () {
"use strict";

var VERSION="v1";
var DATOS={pvgis:null,pvgisMeta:null,price:null,priceMeta:null,solarOn:false,priceOn:false};

/* ======================= UTILIDADES ======================= */
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
function kvGet(key){
  if(typeof idb!=="function")return Promise.resolve(null);
  return idb().then(function(db){return new Promise(function(res){var q=db.transaction("kv","readonly").objectStore("kv").get(key);q.onsuccess=function(){res(q.result);};q.onerror=function(){res(null);};});}).catch(function(){return null;});
}
function kvPut(key,val){
  if(typeof idb!=="function")return Promise.resolve();
  return idb().then(function(db){return new Promise(function(res){var tx=db.transaction("kv","readwrite");tx.objectStore("kv").put(val,key);tx.oncomplete=function(){res();};tx.onerror=function(){res();};});}).catch(function(){});
}
function setMsg(id,txt,bad){
  var el=document.getElementById(id);
  if(!el)return;
  el.textContent=txt;
  el.style.color=bad?"#c0392b":"var(--muted)";
}
function resample(arr,nFrom,nTo){
  var out=new Float64Array(nTo);
  for(var i=0;i<nTo;i++){
    var x=i*(nFrom-1)/Math.max(1,nTo-1),i0=Math.floor(x),i1=Math.min(nFrom-1,i0+1),f=x-i0;
    out[i]=arr[i0]*(1-f)+arr[i1]*f;
  }
  return out;
}
function sumArr(a){var s=0;for(var i=0;i<a.length;i++)s+=a[i];return s;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* ======================= ESQUEMA ======================= */
SCHEMA.push({g:"12 · Precios horarios y datos reales",f:[
  ["priceOn","Aplicar perfil horario de precios","bool",false],
  ["priceBase","Precio base del modelo sintético","num",60,0,400,1,"€/MWh"],
  ["priceDaily","Amplitud del ciclo diario","num",25,0,100,1,"%"],
  ["priceWeekly","Descuento de fin de semana","num",15,0,60,1,"%"],
  ["priceSeasonal","Amplitud estacional","num",20,0,80,1,"%"],
  ["priceNoise","Dispersión horaria","num",20,0,100,1,"%"]
]});
DEFAULTS.priceOn=false;DEFAULTS.priceBase=60;DEFAULTS.priceDaily=25;DEFAULTS.priceWeekly=15;
DEFAULTS.priceSeasonal=20;DEFAULTS.priceNoise=20;
["priceOn","priceBase","priceDaily","priceWeekly","priceSeasonal","priceNoise"].forEach(function(k){
  if(state[k]===undefined)state[k]=DEFAULTS[k];
});

/* ======================= MODELO SINTÉTICO DE PRECIOS ======================= */
function syntheticPrice(){
  var base=num(state.priceBase),dA=num(state.priceDaily)/100,wA=num(state.priceWeekly)/100;
  var sA=num(state.priceSeasonal)/100,nA=num(state.priceNoise)/100;
  var out=new Float64Array(8760),rng=mulberry32(4242);
  for(var h=0;h<8760;h++){
    var day=Math.floor(h/24),hod=h%24,dow=day%7,f=1;
    f+=dA*Math.cos((hod-19.5)/24*2*Math.PI);
    if(dow===5||dow===6)f-=wA;
    f+=sA*Math.cos(4*Math.PI*(day-15)/365);
    f*=1+(rng()-0.5)*2*nA;
    out[h]=Math.max(0,base*f);
  }
  return out;
}

/* ======================= PVGIS ======================= */
function pvgisFetch(){
  var lat=num(document.getElementById("pvLat").value);
  var lon=num(document.getElementById("pvLon").value);
  var year=Math.round(num(document.getElementById("pvYear").value));
  var loss=num(document.getElementById("pvLoss").value);
  var angle=num(document.getElementById("pvAngle").value);
  var aspect=num(document.getElementById("pvAspect").value);
  var url="https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat="+lat+"&lon="+lon+
    "&startyear="+year+"&endyear="+year+"&pvcalculation=1&peakpower=1&loss="+loss+
    "&angle="+angle+"&aspect="+aspect+"&mountingplace=free&outputformat=json&browser=0";
  setMsg("pvMsg","Consultando PVGIS…");
  fetch(url,{mode:"cors"})
    .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
    .then(function(j){
      var hh=j.outputs&&j.outputs.hourly;
      if(!hh||!hh.length)throw new Error("respuesta sin datos horarios");
      var raw=new Float64Array(hh.length),i;
      for(i=0;i<hh.length;i++)raw[i]=(hh[i].P||0)/1000;
      var arr=(hh.length===8760)?raw:resample(raw,hh.length,8760);
      DATOS.pvgis=arr;DATOS.solarOn=true;
      DATOS.pvgisMeta={lat:lat,lon:lon,year:year,loss:loss,angle:angle,aspect:aspect,
        yieldKwh:sumArr(arr),source:"PVGIS v5.2 (JRC)"};
      save();renderDatos();recalc();
      setMsg("pvMsg","Perfil solar importado: "+fmt(sumArr(arr),0)+" kWh/kWp·año.");
    })
    .catch(function(e){
      setMsg("pvMsg","No se pudo descargar ("+e.message+"). Abre re.jrc.ec.europa.eu, descarga el CSV horario y usa «Importar CSV de PVGIS».",true);
    });
}
function parsePvgisCsv(text){
  var lines=text.split(/\r?\n/),i,head=-1,sep=",";
  for(i=0;i<lines.length;i++){
    if(/^time\s*[,;]/i.test(lines[i].trim())){head=i;sep=lines[i].indexOf(";")>=0?";":",";break;}
  }
  if(head<0)return null;
  var cols=lines[head].split(sep).map(function(x){return x.trim().toLowerCase();});
  var iP=cols.indexOf("p"),iG=-1;
  if(iP<0)iG=cols.findIndex(function(c){return /^g\(i\)/.test(c);});
  if(iP<0&&iG<0)return null;
  var vals=[];
  for(i=head+1;i<lines.length;i++){
    var t=lines[i].trim();
    if(!t)continue;
    var c=t.split(sep);
    if(c.length<2)continue;
    var v=parseFloat(c[iP>=0?iP:iG]);
    if(isFinite(v))vals.push(v/1000);
  }
  if(vals.length<100)return null;
  var raw=Float64Array.from(vals);
  return (raw.length===8760)?raw:resample(raw,raw.length,8760);
}
function parsePriceCsv(text){
  var lines=text.split(/\r?\n/).filter(function(l){return l.trim().length;});
  if(!lines.length)return null;
  var sep=lines[0].indexOf(";")>=0?";":",";
  var start=0,idx=-1;
  var head=lines[0].split(sep).map(function(x){return x.trim().toLowerCase();});
  for(var j=0;j<head.length;j++){if(/precio|price|€\/mwh|eur/.test(head[j])){idx=j;break;}}
  if(idx>=0)start=1;
  var vals=[];
  for(var i=start;i<lines.length;i++){
    var c=lines[i].split(sep);
    var v;
    if(idx>=0)v=parseFloat(c[idx]);
    else v=parseFloat(c[c.length-1]);
    if(!isFinite(v))continue;
    if(v>0&&v<10)v*=1000;         /* si viene en €/kWh, pasar a €/MWh */
    vals.push(v);
  }
  if(vals.length<100)return null;
  var raw=Float64Array.from(vals);
  return (raw.length===8760)?raw:resample(raw,raw.length,8760);
}

/* ======================= PRECIO EFECTIVO ======================= */
function effectivePrice(s,profiles){
  try{
    var P=derive(s),pvK=num(s.pvKwp),pvPR=num(s.pvPR),wK=num(s.windKw);
    var imp=0,cost=0;
    for(var h=0;h<8760;h++){
      var renew=(profiles.solar[h]*pvK*pvPR/100+profiles.wind[h]*wK)*P.inv;
      var sp=Math.min(P.pNomMW,renew*P.rect/(1+P.bop));
      if(sp<P.pNomMW*P.minLoad)sp=s.allowGrid?P.pNomMW*P.minLoad:0;
      var acNeed=sp*(1+P.bop)/P.rect;
      var gi=Math.max(0,acNeed-renew);
      imp+=gi;cost+=gi*DATOS.price[h];
    }
    if(imp<=0)return num(s.elecPrice);
    return cost/imp/1000;
  }catch(e){return num(s.elecPrice);}
}

/* ======================= PARCHES ======================= */
if(typeof window.currentSolar==="function"){
  var _cs=window.currentSolar;
  window.currentSolar=function(){
    if(DATOS.solarOn&&DATOS.pvgis)return DATOS.pvgis;
    return _cs.apply(this,arguments);
  };
}
var _simulate=window.simulate;
window.simulate=function(s,profiles){
  if(!DATOS.priceOn||!DATOS.price||!s.priceOn)return _simulate(s,profiles);
  var eff=effectivePrice(s,profiles);
  var s2=Object.assign({},s,{elecPrice:eff});
  var res=_simulate(s2,profiles);
  res.effPrice=eff;
  res.priceProfile=DATOS.price;
  return res;
};
var _recalc=window.recalc;
window.recalc=function(){
  _recalc();
  try{renderDatos();}catch(e){if(window.console)console.warn("[h2datos] render",e);}
};

/* ======================= UI ======================= */
addTab("datos","13 · Datos reales",
'<div class="card"><h2>Recurso solar real · PVGIS</h2>'+
'<p style="color:var(--muted);font-size:.87rem">Descarga el perfil horario de un año concreto o de un año meteorológico típico desde la base PVGIS del Centro Común de Investigación de la Comisión Europea. El perfil se normaliza a kWh por kWp instalado.</p>'+
'<div style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0">'+
'<label style="font-size:.82rem">Latitud<br><input type="number" id="pvLat" value="40.42" step="0.01" style="width:110px"></label>'+
'<label style="font-size:.82rem">Longitud<br><input type="number" id="pvLon" value="-3.70" step="0.01" style="width:110px"></label>'+
'<label style="font-size:.82rem">Año<br><input type="number" id="pvYear" value="2019" step="1" style="width:90px"></label>'+
'<label style="font-size:.82rem">Pérdidas (%)<br><input type="number" id="pvLoss" value="14" step="1" style="width:90px"></label>'+
'<label style="font-size:.82rem">Inclinación (°)<br><input type="number" id="pvAngle" value="35" step="1" style="width:90px"></label>'+
'<label style="font-size:.82rem">Orientación (°)<br><input type="number" id="pvAspect" value="0" step="5" style="width:90px"></label>'+
'</div>'+
'<div class="toolbar"><button class="btn" id="pvGo">Descargar de PVGIS</button>'+
'<button class="btn ghost" id="pvCsvBtn">Importar CSV de PVGIS</button>'+
'<input type="file" id="pvCsv" accept=".csv,.txt" hidden>'+
'<span id="pvMsg" style="color:var(--muted);font-size:.83rem"></span></div>'+
'<div id="pvInfo"></div>'+
'<div class="scroll"><svg id="pvChart" class="chart" viewBox="0 0 1000 280" role="img" aria-label="Perfil solar"></svg></div></div>'+
'<div class="card"><h2>Precios horarios de la electricidad</h2>'+
'<p style="color:var(--muted);font-size:.87rem">Importa un CSV con precios horarios (OMIE, ENTSO-E, Red Eléctrica) o genera un perfil sintético con la forma típica del mercado ibérico. El motor calcula un <strong>precio efectivo ponderado</strong> por la importación real de red de cada hora.</p>'+
'<div class="toolbar"><button class="btn ghost" id="prCsvBtn">Importar CSV de precios</button>'+
'<input type="file" id="prCsv" accept=".csv,.txt" hidden>'+
'<button class="btn ghost" id="prSynth">Generar perfil sintético</button>'+
'<span id="prMsg" style="color:var(--muted);font-size:.83rem"></span></div>'+
'<div id="prInfo"></div>'+
'<div class="scroll"><svg id="prChart" class="chart" viewBox="0 0 1000 280" role="img" aria-label="Perfil de precios"></svg></div></div>'+
'<div class="card"><h2>Estado de los datos</h2><div id="datosEstado" class="metrics"></div>'+
'<div class="toolbar"><button class="btn ghost" id="datosReset">Volver a los perfiles sintéticos</button></div>'+
'<div class="note warn" style="margin-top:10px"><strong>Sobre PVGIS y el CORS.</strong> Si el navegador bloquea la descarga directa, no es un fallo del módulo: algunos navegadores y redes corporativas lo impiden. En ese caso descarga el CSV desde <em>re.jrc.ec.europa.eu</em> y usa el botón de importación. Funciona igual.</div></div>');

function renderDatos(){
  var est=document.getElementById("datosEstado");
  if(!est)return;
  var pm=DATOS.pvgisMeta,prm=DATOS.priceMeta;
  est.innerHTML=[
    metric("Perfil solar",DATOS.solarOn?"PVGIS":"Sintético",pm?("año "+pm.year+" · "+fmt(pm.yieldKwh,0)+" kWh/kWp"):"modelo de cielo claro"),
    metric("Perfil de precios",(DATOS.priceOn&&DATOS.price)?(prm?prm.source:"importado"):"Precio plano",(DATOS.priceOn&&DATOS.price)?("media "+fmt(sumArr(DATOS.price)/8760,1)+" €/MWh"):(fmt(num(state.elecPrice)*1000,1)+" €/MWh")),
    metric("Precio efectivo","—",window.result&&window.result.effPrice?("calculado: "+fmt(window.result.effPrice*1000,1)+" €/MWh"):"activa el perfil horario")
  ].join("");
  var info=document.getElementById("pvInfo");
  if(info)info.innerHTML=pm?('<div class="note info">Lat '+fmt(pm.lat,3)+' · Lon '+fmt(pm.lon,3)+' · '+pm.year+' · pérdidas '+fmt(pm.loss,0)+' % · inclinación '+fmt(pm.angle,0)+'° · orientación '+fmt(pm.aspect,0)+'° · fuente '+esc(pm.source)+'</div>'):"";
  var info2=document.getElementById("prInfo");
  if(info2)info2.innerHTML=prm?('<div class="note info">'+esc(prm.source)+' · '+fmt0(prm.n)+' valores · mínimo '+fmt(prm.min,1)+' €/MWh · máximo '+fmt(prm.max,1)+' €/MWh</div>'):"";
  if(DATOS.pvgis){
    var wk=[];for(var i=0;i<168;i++)wk.push(DATOS.pvgis[i]*1000);
    svgLine(document.getElementById("pvChart"),[{data:wk,color:"#e3a31c",w:1.8}],{h:280,xLabel:function(j){return "h"+j;}});
  }
  if(DATOS.price){
    var wk2=[];for(var k=0;k<168;k++)wk2.push(DATOS.price[k]);
    svgLine(document.getElementById("prChart"),[{data:wk2,color:"#4a7fd4",w:1.8}],{h:280,xLabel:function(j){return "h"+j;}});
  }
}
document.getElementById("pvGo").addEventListener("click",pvgisFetch);
document.getElementById("pvCsvBtn").addEventListener("click",function(){document.getElementById("pvCsv").click();});
document.getElementById("pvCsv").addEventListener("change",function(ev){
  var f=ev.target.files&&ev.target.files[0];
  if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    var arr=parsePvgisCsv(String(rd.result));
    if(!arr){setMsg("pvMsg","No se reconoce el formato del CSV de PVGIS.",true);return;}
    DATOS.pvgis=arr;DATOS.solarOn=true;
    DATOS.pvgisMeta={lat:NaN,lon:NaN,year:0,loss:0,angle:0,aspect:0,yieldKwh:sumArr(arr),source:"CSV de PVGIS"};
    save();renderDatos();recalc();
    setMsg("pvMsg","Perfil solar importado: "+fmt(sumArr(arr),0)+" kWh/kWp·año.");
  };
  rd.readAsText(f);
});
document.getElementById("prCsvBtn").addEventListener("click",function(){document.getElementById("prCsv").click();});
document.getElementById("prCsv").addEventListener("change",function(ev){
  var f=ev.target.files&&ev.target.files[0];
  if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    var arr=parsePriceCsv(String(rd.result));
    if(!arr){setMsg("prMsg","No se reconoce el formato del CSV de precios.",true);return;}
    var mn=1e18,mx=-1e18;
    for(var i=0;i<arr.length;i++){if(arr[i]<mn)mn=arr[i];if(arr[i]>mx)mx=arr[i];}
    DATOS.price=arr;DATOS.priceOn=true;
    DATOS.priceMeta={source:"CSV importado",n:arr.length,min:mn,max:mx};
    state.priceOn=true;save();renderDatos();recalc();
    setMsg("prMsg","Perfil de precios importado. Media "+fmt(sumArr(arr)/8760,1)+" €/MWh.");
  };
  rd.readAsText(f);
});
document.getElementById("prSynth").addEventListener("click",function(){
  var arr=syntheticPrice();
  var mn=1e18,mx=-1e18;
  for(var i=0;i<arr.length;i++){if(arr[i]<mn)mn=arr[i];if(arr[i]>mx)mx=arr[i];}
  DATOS.price=arr;DATOS.priceOn=true;
  DATOS.priceMeta={source:"Modelo sintético (forma del mercado ibérico)",n:8760,min:mn,max:mx};
  state.priceOn=true;save();renderDatos();recalc();
  setMsg("prMsg","Perfil sintético generado. Media "+fmt(sumArr(arr)/8760,1)+" €/MWh.");
});
document.getElementById("datosReset").addEventListener("click",function(){
  DATOS.pvgis=null;DATOS.price=null;DATOS.solarOn=false;DATOS.priceOn=false;
  DATOS.pvgisMeta=null;DATOS.priceMeta=null;
  state.priceOn=false;
  save();renderDatos();recalc();
  setMsg("pvMsg","Perfiles sintéticos restaurados.");
});

/* ======================= PERSISTENCIA Y ARRANQUE ======================= */
function save(){
  kvPut("h2datos",{
    pvgis:DATOS.pvgis?Array.prototype.slice.call(DATOS.pvgis):null,
    price:DATOS.price?Array.prototype.slice.call(DATOS.price):null,
    pvgisMeta:DATOS.pvgisMeta,priceMeta:DATOS.priceMeta,
    solarOn:DATOS.solarOn,priceOn:DATOS.priceOn
  }).catch(function(){});
}
function start(){
  renderForm();
  kvGet("h2datos").then(function(d){
    if(d){
      if(d.pvgis)DATOS.pvgis=Float64Array.from(d.pvgis);
      if(d.price)DATOS.price=Float64Array.from(d.price);
      DATOS.pvgisMeta=d.pvgisMeta||null;DATOS.priceMeta=d.priceMeta||null;
      DATOS.solarOn=!!d.solarOn;DATOS.priceOn=!!d.priceOn;
    }
    renderDatos();
    try{recalc();}catch(e){}
  }).catch(function(){try{recalc();}catch(e){}});
  if(window.console)console.log("[h2datos] "+VERSION+" cargado correctamente.");
}
var bootTries=0;
function boot(){
  bootTries++;
  var ok=window.simulate&&window.SCHEMA&&window.state&&window.derive&&window.currentSolar;
  var listo=ok&&(document.getElementById("projSelect")||bootTries>40);
  if(!listo){setTimeout(boot,80);return;}
  try{start();}catch(e){if(window.console)console.error("[h2datos]",e);}
}
boot();
})();
