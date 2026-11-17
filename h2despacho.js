/* =====================================================================
   H2 VERDE · Módulo de almacenamiento y despacho óptimo · v1
   - Batería con estado de carga, potencia, rendimiento y CAPEX
   - Despacho óptimo por programación dinámica (exacto para el problema
     discretizado: equivale a la solución MILP con SOC discretizado)
   - Comparación contra el despacho voraz actual y barrido de tamaño
   Instalación: añadir <script src="./h2despacho.js"></script> antes de </body>
   ===================================================================== */
(function () {
"use strict";

var VERSION="v1";
var DP_ENABLED=false;
var DP_CACHE={key:"",pol:null};
var BASE_CACHE={key:"",res:null};

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
function bar(pct,color){
  return '<span style="display:inline-block;height:9px;border-radius:4px;background:'+color+';width:'+Math.max(0,Math.min(100,pct)).toFixed(1)+'%"></span>';
}

/* ======================= ESQUEMA ======================= */
SCHEMA.push({g:"10 · Almacenamiento y despacho óptimo",f:[
  ["batOn","Activar batería y despacho óptimo","bool",false],
  ["batMWh","Capacidad de la batería","num",20,0,undefined,1,"MWh"],
  ["batMW","Potencia de la batería","num",5,0,undefined,0.5,"MW"],
  ["batEff","Rendimiento de ida y vuelta","num",90,50,100,0.5,"%","Litio-ion actual: 88–93 %."],
  ["batSOCmin","Estado de carga mínimo","num",10,0,50,1,"%"],
  ["batSOCmax","Estado de carga máximo","num",90,50,100,1,"%"],
  ["batCapex","CAPEX de la batería","num",350,0,undefined,10,"€/kWh","Sistema completo instalado: 250–450 €/kWh."],
  ["batOpexPct","OPEX de la batería","num",1.5,0,10,0.1,"% del CAPEX/año"],
  ["h2Shadow","Valor sombra del H₂ en el despacho","num",5.5,0,undefined,0.1,"€/kg","Precio al que el optimizador valora cada kg producido."]
]});
DEFAULTS.batOn=false;DEFAULTS.batMWh=20;DEFAULTS.batMW=5;DEFAULTS.batEff=90;
DEFAULTS.batSOCmin=10;DEFAULTS.batSOCmax=90;DEFAULTS.batCapex=350;DEFAULTS.batOpexPct=1.5;DEFAULTS.h2Shadow=5.5;
["batOn","batMWh","batMW","batEff","batSOCmin","batSOCmax","batCapex","batOpexPct","h2Shadow"].forEach(function(k){
  if(state[k]===undefined)state[k]=DEFAULTS[k];
});

/* ======================= DESPACHO ÓPTIMO (DP) ======================= */
function dpKey(s,cfg){
  return [s.batMWh,s.batMW,s.batEff,s.batSOCmin,s.batSOCmax,s.h2Shadow,s.gridPrice,cfg.allowGrid?1:0,
    cfg.stack.pNomMW,cfg.stack.minLoad,cfg.pvKwp,cfg.pvPR,cfg.windKw,
    s.solarProfileId,s.windProfileId,s.latDeg,s.solarCF,s.windCF].join("|");
}
function dpPolicy(cfg,lut,s){
  var P=cfg.stack,inv=P.inv,rect=P.rect,bop=P.bop,minLoad=P.minLoad,pNom=P.pNomMW;
  var batCap=Math.max(0.001,num(s.batMWh)),batP=Math.max(0.001,num(s.batMW));
  var eta=clamp(num(s.batEff)/100,0.5,1),etaC=Math.sqrt(eta),etaD=Math.sqrt(eta);
  var socMin=clamp(num(s.batSOCmin)/100,0,0.9)*batCap;
  var socMax=clamp(num(s.batSOCmax)/100,0.1,1)*batCap;
  if(socMax<=socMin+1e-6)socMax=socMin+batCap*0.5;
  var lambda=num(s.h2Shadow),price=num(s.gridPrice),allowGrid=!!cfg.allowGrid;
  var N=8760,NS=17,NA=5;
  var socStep=(socMax-socMin)/(NS-1);
  var acts=new Float64Array(NA);
  for(var a=0;a<NA;a++)acts[a]=(a/(NA-1)*2-1)*batP;
  var V=new Float64Array((N+1)*NS);
  var POL=new Uint8Array(N*NS);
  var h,si,ai;
  for(h=N-1;h>=0;h--){
    var R=cfg.solar[h]*cfg.pvKwp*cfg.pvPR/100+cfg.wind[h]*cfg.windKw;
    var base=h*NS,baseN=(h+1)*NS;
    for(si=0;si<NS;si++){
      var soc=socMin+si*socStep;
      var best=-1e18,bestA=0;
      for(ai=0;ai<NA;ai++){
        var b=acts[ai];
        var socNext=soc-(b>0?b/etaD:b*etaC);
        if(socNext<socMin-1e-6||socNext>socMax+1e-6)continue;
        var sNext=Math.round((socNext-socMin)/socStep);
        if(sNext<0||sNext>=NS)continue;
        var acAvail=R+b,gi=0;
        if(acAvail<0){if(!allowGrid)continue;gi=-acAvail;acAvail=0;}
        var stack=Math.min(pNom,acAvail*inv*rect/(1+bop));
        if(stack<pNom*minLoad)stack=0;
        var kg=stack>0?(stack*1000/consAt(lut,stack)):0;
        var val=lambda*kg-gi*price+V[baseN+sNext];
        if(val>best){best=val;bestA=ai;}
      }
      V[base+si]=best;POL[base+si]=bestA;
    }
  }
  return {acts:acts,POL:POL,socMin:socMin,socStep:socStep,NS:NS};
}
function simYearDP(cfg,lut,s){
  var P=cfg.stack,inv=P.inv,rect=P.rect,bop=P.bop,minLoad=P.minLoad,pNom=P.pNomMW;
  var key=dpKey(s,cfg);
  if(DP_CACHE.key!==key||!DP_CACHE.pol){
    DP_CACHE.key=key;
    DP_CACHE.pol=dpPolicy(cfg,lut,s);
  }
  var pol=DP_CACHE.pol,acts=pol.acts,NS=pol.NS,socMin=pol.socMin,socStep=pol.socStep;
  var eta=clamp(num(s.batEff)/100,0.5,1),etaC=Math.sqrt(eta),etaD=Math.sqrt(eta);
  var N=8760;
  var si=Math.floor(NS/2),soc=socMin+si*socStep;
  var solarG=0,windG=0,gridImp=0,invLoss=0,curt=0,rectLoss=0,bopE=0,stackE=0,kg=0,acUsed=0,batThru=0;
  var H={solar:new Float64Array(N),stack:new Float64Array(N),load:new Float64Array(N),kg:new Float64Array(N)};
  var socTrace=new Float64Array(N);
  for(var h=0;h<N;h++){
    var s2=cfg.solar[h]*cfg.pvKwp*cfg.pvPR/100,w2=cfg.wind[h]*cfg.windKw,R=s2+w2;
    var b=acts[pol.POL[h*NS+si]];
    soc=soc-(b>0?b/etaD:b*etaC);
    batThru+=Math.abs(b);
    si=Math.round((soc-socMin)/socStep);
    if(si<0)si=0;if(si>=NS)si=NS-1;
    var acAvail=R+b,gi=0;
    if(acAvail<0){gi=-acAvail;acAvail=0;}
    var stack=Math.min(pNom,acAvail*inv*rect/(1+bop));
    if(stack<pNom*minLoad)stack=0;
    var acU=stack*(1+bop)/rect;
    var kgH=stack>0?(stack*1000/consAt(lut,stack)):0;
    solarG+=s2;windG+=w2;gridImp+=gi;
    invLoss+=R*(1-inv);
    curt+=Math.max(0,acAvail-acU);
    rectLoss+=acU-stack*(1+bop);
    bopE+=stack*bop;stackE+=stack;acUsed+=acU;kg+=kgH;
    H.solar[h]=R;H.stack[h]=stack*1000;H.load[h]=pNom>0?stack/pNom:0;H.kg[h]=kgH;
    socTrace[h]=soc;
  }
  return {solarG:solarG,windG:windG,gridImp:gridImp,invLoss:invLoss,curt:curt,rectLoss:rectLoss,
    bopE:bopE,stackE:stackE,acUsed:acUsed,kg:kg,H:H,batThru:batThru,socTrace:socTrace};
}

/* ======================= PARCHES ======================= */
var _simYear=window.simYear;
window.simYear=function(cfg,lut){
  if(!DP_ENABLED)return _simYear(cfg,lut);
  try{return simYearDP(cfg,lut,state);}
  catch(e){if(window.console)console.warn("[h2despacho] DP",e);return _simYear(cfg,lut);}
};
var _simulate=window.simulate;
window.simulate=function(s,profiles){
  DP_ENABLED=!!(s.batOn&&num(s.batMWh)>0);
  try{return _simulate(s,profiles);}finally{DP_ENABLED=false;}
};
var _economics=window.economics;
window.economics=function(s,perYear){
  var e=_economics(s,perYear);
  try{
    if(s.batOn&&num(s.batMWh)>0){
      var batCost=num(s.batMWh)*1000*num(s.batCapex);
      var r=num(s.rate)/100,life=perYear.length,y;
      var batNPV=batCost/Math.pow(1+r,1);
      var opexNPV=0;
      for(y=1;y<=life;y++)opexNPV+=batCost*num(s.batOpexPct)/100*Math.pow(1+num(s.infl)/100,y-1)/Math.pow(1+r,y);
      var d=(e.npvKg>0)?(batNPV+opexNPV)/e.npvKg:0;
      e.capex.bateria=batCost;
      e.capex.total+=batCost;
      e.npvCost+=batNPV+opexNPV;
      e.lcoh+=d;
      e.lcohNoCap+=d;
      e.npv-=batNPV+opexNPV;
      e.batNPV=batNPV;e.batOpexNPV=opexNPV;e.batCost=batCost;e.batDelta=d;
    }
  }catch(err){if(window.console)console.warn("[h2despacho] economics",err);}
  return e;
};
var _recalc=window.recalc;
window.recalc=function(){
  _recalc();
  try{if(window.result)renderDespacho(window.result);}catch(e){if(window.console)console.warn("[h2despacho] render",e);}
};

/* ======================= UI ======================= */
addTab("despacho","12 · Almacenamiento",
'<div class="card"><h2>Almacenamiento y despacho óptimo</h2>'+
'<div class="note info">Con la batería activada, el motor resuelve el despacho horario por <strong>programación dinámica sobre el estado de carga</strong>: es la solución exacta del problema discretizado, equivalente al MILP. El resto de la aplicación (LCOH, ciclado, agua y O₂) ya usa ese despacho.</div>'+
'<div id="despKpis" class="metrics"></div></div>'+
'<div class="card"><h2>Comparación: despacho voraz vs despacho óptimo</h2>'+
'<div class="scroll"><table id="despComp"></table></div></div>'+
'<div class="card"><h2>Estado de carga de la batería · primera semana</h2>'+
'<div class="scroll"><svg id="despSoc" class="chart" viewBox="0 0 1000 300" role="img" aria-label="Estado de carga"></svg></div></div>'+
'<div class="card"><h2>Dimensionado de la batería</h2>'+
'<div class="toolbar"><button class="btn" id="despSweep">Barrer capacidades</button>'+
'<span id="despMsg" style="color:var(--muted);font-size:.83rem"></span></div>'+
'<div class="scroll"><table id="despSweepTab"></table></div></div>');

function baseline(){
  var key=[state.pvKwp,state.windKw,state.stackMW,state.tech,state.solarProfileId,state.windProfileId,
    state.latDeg,state.solarCF,state.windCF,state.allowGrid?1:0,state.gridPrice].join("|");
  if(BASE_CACHE.key===key&&BASE_CACHE.res)return BASE_CACHE.res;
  var profiles={solar:currentSolar(),wind:currentWind()};
  var s2=Object.assign({},state,{batOn:false});
  var prev=DP_ENABLED;DP_ENABLED=false;
  var res=null;
  try{res=_simulate(s2,profiles);}catch(e){}
  DP_ENABLED=prev;
  BASE_CACHE.key=key;BASE_CACHE.res=res;
  return res;
}
function renderDespacho(r){
  var k=document.getElementById("despKpis");
  if(!k||!r)return;
  var on=!!state.batOn;
  var e=r.econ;
  var batThru=0,socMean=NaN;
  if(r.y0.r.batThru!==undefined){
    batThru=r.y0.r.batThru;
    var tr=r.y0.r.socTrace,sum=0;
    for(var i=0;i<tr.length;i++)sum+=tr[i];
    socMean=sum/tr.length;
  }
  var cap=num(state.batMWh);
  var cycles=cap>0?batThru/(2*cap):0;
  k.innerHTML=[
    metric("Estado","Batería "+(on?"activa":"desactivada"),on?"despacho óptimo por DP":"despacho voraz"),
    metric("Capacidad",fmt(cap,1)+" MWh","potencia "+fmt(num(state.batMW),1)+" MW"),
    metric("Energía movida",fmt(batThru/1000,1)+" MWh/año","ciclos equivalentes: "+fmt(cycles,0)),
    metric("Estado de carga medio",isFinite(socMean)?fmt(100*socMean/Math.max(cap,1e-9),1)+" %":"—"),
    metric("Impacto en el LCOH",e.batDelta!==undefined?("+"+fmt(e.batDelta,3)+" €/kg"):"—","CAPEX batería "+fmt0(e.batCost||0)+" €",(e.batDelta||0)>0.15?"warn":"alt"),
    metric("LCOH actual",fmt(e.lcoh)+" €/kg")
  ].join("");
  var b=baseline();
  if(b){
    var rows=[
      ["H₂ producido",fmt0(b.y0.kg)+" kg/año",fmt0(r.y0.kg)+" kg/año",fmt0(r.y0.kg-b.y0.kg)+" kg"],
      ["Energía renovable vertida",fmt(b.y0.r.curt/1000,1)+" MWh/año",fmt(r.y0.r.curt/1000,1)+" MWh/año",fmt((r.y0.r.curt-b.y0.r.curt)/1000,1)+" MWh"],
      ["Importación de red",fmt(b.y0.r.gridImp/1000,1)+" MWh/año",fmt(r.y0.r.gridImp/1000,1)+" MWh/año",fmt((r.y0.r.gridImp-b.y0.r.gridImp)/1000,1)+" MWh"],
      ["Horas equivalentes",fmt0(b.econ.flh)+" h/año",fmt0(r.econ.flh)+" h/año",fmt0(r.econ.flh-b.econ.flh)+" h"],
      ["LCOH",fmt(b.econ.lcoh)+" €/kg",fmt(r.econ.lcoh)+" €/kg",fmt(r.econ.lcoh-b.econ.lcoh)+" €/kg"],
      ["VAN",fmt0(b.econ.npv)+" €",fmt0(r.econ.npv)+" €",fmt0(r.econ.npv-b.econ.npv)+" €"]
    ];
    document.getElementById("despComp").innerHTML=
    '<thead><tr><th>Métrica</th><th>Sin batería (voraz)</th><th>Con batería (óptimo)</th><th>Diferencia</th></tr></thead><tbody>'+
    rows.map(function(x){return '<tr><td>'+esc(x[0])+'</td><td>'+x[1]+'</td><td>'+x[2]+'</td><td><strong>'+x[3]+'</strong></td></tr>';}).join("")+'</tbody>';
  }
  if(r.y0.r.socTrace){
    var tr2=r.y0.r.socTrace,wk=[];
    for(var j=0;j<168;j++)wk.push(100*tr2[j]/Math.max(cap,1e-9));
    svgLine(document.getElementById("despSoc"),[{data:wk,color:"#4a7fd4",w:1.8}],{h:300,maxY:100,xLabel:function(i2){return "h"+i2;}});
  }
}
document.getElementById("despSweep").addEventListener("click",function(){
  var caps=[0,5,10,20,40,80,160];
  var profiles={solar:currentSolar(),wind:currentWind()};
  var out=[],i=0;
  document.getElementById("despMsg").textContent="Barriendo "+caps.length+" capacidades…";
  function step(){
    var t0=performance.now();
    while(i<caps.length&&performance.now()-t0<400){
      var c=caps[i];
      var s2=Object.assign({},state,{batOn:c>0,batMWh:c,batMW:Math.max(1,c/4)});
      DP_CACHE.key="";
      var res=null;
      try{res=simulate(s2,profiles);}catch(e){}
      if(res)out.push({c:c,lcoh:res.econ.lcoh,kg:res.y0.kg,curt:res.y0.r.curt,npv:res.econ.npv});
      i++;
    }
    if(i<caps.length){document.getElementById("despMsg").textContent="Barriendo… "+i+"/"+caps.length;setTimeout(step,0);}
    else{
      DP_CACHE.key="";
      var best=out[0];
      out.forEach(function(o){if(o.lcoh<best.lcoh)best=o;});
      document.getElementById("despMsg").textContent="Óptimo: "+fmt(best.c,0)+" MWh → LCOH "+fmt(best.lcoh)+" €/kg";
      document.getElementById("despSweepTab").innerHTML=
      '<thead><tr><th>Capacidad</th><th>LCOH</th><th>H₂ producido</th><th>Vertido</th><th>VAN</th><th></th></tr></thead><tbody>'+
      out.map(function(o){
        var isBest=(o===best);
        return '<tr'+(isBest?' style="background:#e8f7ef"':'')+'><td>'+fmt(o.c,0)+' MWh</td><td>'+fmt(o.lcoh)+' €/kg</td>'+
        '<td>'+fmt0(o.kg)+' kg/año</td><td>'+fmt(o.curt/1000,1)+' MWh/año</td><td>'+fmt0(o.npv)+' €</td>'+
        '<td>'+(isBest?'<span class="pill ok">óptimo</span>':'')+'</td></tr>';
      }).join("")+'</tbody>';
      recalc();
    }
  }
  step();
});

/* ======================= ARRANQUE ======================= */
function start(){
  renderForm();
  try{recalc();}catch(e){if(window.console)console.warn("[h2despacho] recalc",e);}
  if(window.result)renderDespacho(window.result);
  if(window.console)console.log("[h2despacho] "+VERSION+" cargado correctamente.");
}
var bootTries=0;
function boot(){
  bootTries++;
  var ok=window.simulate&&window.SCHEMA&&window.state&&window.derive&&window.simYear;
  var listo=ok&&(document.getElementById("projSelect")||bootTries>40);
  if(!listo){setTimeout(boot,80);return;}
  try{start();}catch(e){if(window.console)console.error("[h2despacho]",e);}
}
boot();
})();
