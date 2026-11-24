const W=1000, H=620, TAU=Math.PI*2;
const channels=color=>[1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
const rgb=values=>'rgb('+values.map(Math.round).join(',')+')';
const colorWith=(hex,values,amount)=>amount?rgb(channels(hex).map((value,index)=>value+(values[index]-value)*amount)):hex;
const seedUnit=(seed,index)=>{
  let hash=Math.imul((seed+374761393)^index,1274126177);
  hash=Math.imul(hash^(hash>>>16),2246822519);
  return ((hash^(hash>>>13))>>>0)/4294967296;
};
function withAlpha(context,alpha,draw){
  context.save();context.globalAlpha*=alpha;draw();context.restore();
}
function rect(context,x,y,w,h,color){
  context.fillStyle=color;context.fillRect(x,y,w,h);
}
function polygon(context,points,color){
  context.beginPath();
  points.forEach(([x,y],index)=>index?context.lineTo(x,y):context.moveTo(x,y));
  context.closePath();context.fillStyle=color;context.fill();
}
function ellipse(context,x,y,rx,ry,color,angle=0){
  context.beginPath();context.ellipse(x,y,rx,ry,angle,0,TAU);
  context.fillStyle=color;context.fill();
}
function path(context,color,width,build){
  context.beginPath();build(context);context.strokeStyle=color;context.lineWidth=width;context.stroke();
}
function gradient(context,x,y,xx,yy,stops){
  const fill=context.createLinearGradient(x,y,xx,yy);
  stops.forEach(([offset,color])=>fill.addColorStop(offset,color));
  return fill;
}
function wash(context,x,y,rx,ry,color,alpha,softness=.23,angle=0){
  context.save();context.translate(x,y);context.rotate(angle);context.scale(rx,ry);
  const fill=context.createRadialGradient(0,0,0,0,0,1);
  fill.addColorStop(0,color);
  if(softness)fill.addColorStop(softness,color);
  fill.addColorStop(1,'#0000');
  context.globalAlpha*=alpha;rect(context,-1,-1,2,2,fill);context.restore();
}
function plane(context,points,color,smooth=true){
  context.beginPath();context.moveTo(...points[0]);
  for(let index=1;index<points.length;index++){
    const [x,y]=points[index], [priorX,priorY]=points[index-1];
    const middle=(x+priorX)/2;
    if(smooth)context.bezierCurveTo(middle,priorY,middle,y,x,y);
    else context.lineTo(x,y);
  }
  context.lineTo(W,H);context.lineTo(0,H);context.closePath();
  context.fillStyle=color;context.fill();
}
function stars(context,{rand,quality,shine},count){
  for(let index=0;index<Math.round(count*quality);index++){
    const x=rand(index*4)*W, y=rand(index*4+1)*H;
    const radius=.4+Math.pow(rand(index*4+2),5)*2.05;
    withAlpha(context,.16+rand(index*4+3)*.63,()=>ellipse(context,x,y,radius,radius,shine));
  }
}
function nebula(context,state){
  const {base,sky,middle,shine,t,rand}=state;
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,base],[.61,sky],[1,base]]));
  stars(context,state,180);
  for(let index=0;index<12;index++){
    const x=-80+index*95+Math.sin(t*.17+index)*23;
    const y=520-index*37+Math.sin(index*1.8)*49;
    wash(context,x,y,205+rand(index+900)*75,48+rand(index+700)*57,index%3?middle:shine,index%3?.25:.16,0,-.38);
  }
}
function valley(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,sky],[.55,base],[1,middle]]));
  wash(context,720,138,290,155,shine,.42,0);
  plane(context,[[0,221],[135,271],[256,293],[405,402],[583,388],[739,302],[902,291],[1000,244]],middle);
  plane(context,[[0,300],[151,394],[271,423],[430,479],[570,462],[727,406],[846,400],[1000,314]],
    gradient(context,0,365,0,H,[[0,base],[1,foreground]]));
  plane(context,[[0,410],[128,441],[218,497],[411,557],[620,572],[824,538],[1000,444]],foreground);
  wash(context,510+Math.sin(t*.18)*37,455,574,90,base,.77,0,.025);
  wash(context,390+Math.cos(t*.15)*55,520,360,66,shine,.38,0,-.06);
}
function fibers(context,{base,sky,middle,foreground,shine,rand,quality}){
  rect(context,0,0,W,H,gradient(context,0,20,W,H,[[0,sky],[.55,base],[1,middle]]));
  for(let index=0;index<700*quality+330;index++){
    const seed=index*5, x=W*rand(seed),y=H*rand(seed+1), length=2+rand(seed+2)*16;
    const angle=(rand(seed+3)-.5)*Math.PI*.66;
    withAlpha(context,(.04+rand(seed+4)*.26)*(x>370&&x<850&&y>130&&y<485?.58:1),()=>
      path(context,index%3?foreground:sky,.65,p=>{p.moveTo(x,y);p.quadraticCurveTo(x+length*.5,y+.4,x+Math.cos(angle)*length,y+Math.sin(angle)*length);}));
  }
  wash(context,100,600,286,108,foreground,.29,0,-.16);
  withAlpha(context,.19,()=>path(context,foreground,1.25,p=>{
    for(let x=0;x<=W;x+=5){
      const y=492+15*Math.sin(x*.007)+rand(253+x)*4;
      if(x)p.lineTo(x,y);
      else p.moveTo(x,y);
    }
  }));
  wash(context,922,34,178,94,middle,.45,0,.18);
  withAlpha(context,.68,()=>{
    polygon(context,[[196,516],[232,516],[231,554],[194,551]],shine);
    path(context,base,1.6,p=>{p.moveTo(201,528);p.lineTo(226,528);p.moveTo(212,522);p.lineTo(210,545);p.lineTo(223,542);});
  });
}
function reedGlass(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,W,0,0,H,[[0,sky],[.5,base],[1,middle]]));
  const glare=206+Math.sin(t*.21)*76;
  wash(context,glare,85,330,530,shine,.76,0,-.44);
  wash(context,860,530,395,350,sky,.42,0);
  for(let index=0;index<26;index++){
    const x=index*41-15, alpha=x>330&&x<834?.39:.78;
    const pane=gradient(context,x,0,x+37,0,[[0,'#0000'],[.12,'#ffffff65'],[.29,'#ffffff10'],[.85,'#0000'],[1,foreground]]);
    withAlpha(context,alpha,()=>rect(context,x,0,39,H,pane));
    if(index%6===5)rect(context,x+32,0,2,H,'#ffffff50');
  }
}
function gallery(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,sky],[.58,base],[1,middle]]));
  const vx=878, vy=315;
  polygon(context,[[0,H],[W,H],[W,vy-9],[vx,vy],[0,513]],middle);
  polygon(context,[[0,0],[W,0],[W,vy-59],[vx,vy-21],[0,136]],sky);
  for(let index=0;index<7;index++){
    const scale=Math.pow(.72,index),x=vx-(vx+80)*scale,post=57*scale;
    const top=vy-(vy+35)*scale,bottom=vy+(H-vy+69)*scale;
    polygon(context,[[x,top],[x+post,top+12*scale],[x+post,bottom-13*scale],[x,bottom]],foreground);
    polygon(context,[[x+post,top+12*scale],[x+post+13*scale,top+22*scale],[x+post+13*scale,bottom-25*scale],[x+post,bottom-13*scale]],sky);
    const drift=Math.sin(t*.15)*18;
    withAlpha(context,index<3?.46:.28,()=>polygon(context,[[x+post,bottom-58*scale],[x+post+99*scale,bottom-76*scale],[x+post+220*scale+drift,bottom+59*scale],[x+post+71*scale,bottom+89*scale]],shine));
  }
  wash(context,vx,vy,180,95,shine,.34,0);
}
function calm(context,{base,sky,middle,shine,style}){
  if(style==='diagonal'){
    rect(context,0,0,W,H,gradient(context,0,H,W,0,[[0,middle],[.54,base],[1,sky]]));
    return;
  }
  rect(context,0,0,W,H,gradient(context,0,0,540,H,[[0,sky],[.52,base],[1,middle]]));
  wash(context,0,0,680,465,shine,.48,0);
}
function skyGradient(context,state,stop=.64){
  const {sky,base,middle}=state;
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,sky],[stop,base],[1,middle]]));
}
function orbit(context,state){
  const {base,sky,middle,shine,t}=state;
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.7,base],[1,'#111827']]));
  stars(context,state,128);
  wash(context,285,343,183,197,middle,.42,0);
  context.save();context.translate(273,346);context.rotate(-.39);
  for(let index=0;index<5;index++){
    const radius=116+index*44;
    withAlpha(context,.31-index*.036,()=>path(context,shine,1.45,p=>p.ellipse(0,0,radius,radius*.46,0,0,TAU)));
    for(let dot=0;dot<3;dot++){
      const angle=1.69*dot+1.37*index+t*(.16-index*.018);
      const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius*.46;
      wash(context,x,y,13,13,shine,.57,0);
      ellipse(context,x,y,2.6,2.6,shine);
    }
  }
  ellipse(context,0,0,38,38,gradient(context,-26,-28,36,37,[[0,middle],[1,base]]));
  context.restore();
}
function meteors(context,state){
  const {base,sky,shine,t,rand}=state;
  rect(context,0,0,W,H,gradient(context,0,H,W,0,[[0,base],[.67,sky],[1,base]]));
  stars(context,state,102);
  for(let index=0;index<16;index++){
    const travel=t*(68+rand(70+index)*82),x=(rand(index)*1220+travel)%1220-95;
    const y=(rand(index+22)*800-travel*.57%800+800)%800-95;
    const span=42+rand(index+42)*149;
    const tail=gradient(context,x-span,y+span*.57,x,y,[[0,'#0000'],[.69,'#a6cee45a'],[1,shine]]);
    withAlpha(context,.32+rand(index+80)*.51,()=>path(context,tail,index%5===0?2.35:1.1,p=>{p.moveTo(x-span,y+span*.57);p.lineTo(x,y);}));
  }
}
function accretion(context,state){
  const {base,sky,middle,foreground,shine,t}=state;
  rect(context,0,0,W,H,gradient(context,0,H,W,0,[[0,sky],[.67,base],[1,foreground]]));
  stars(context,state,105);
  wash(context,247,329,345,146,middle,.48,0,-.29);
  context.save();context.translate(258,333);context.rotate(-.29);
  for(let index=0;index<18;index++){
    const radius=103+index*9, begin=Math.PI+Math.sin(t*.17+index)*.65;
    withAlpha(context,.66-index*.026,()=>path(context,index%4?middle:shine,index%5===0?3.4:1.1,p=>p.ellipse(0,0,radius,radius*.36,0,begin,begin+2.7)));
  }
  ellipse(context,0,0,92,83,'#120e1c');
  withAlpha(context,.65,()=>path(context,shine,2,p=>p.ellipse(0,0,96,87,0,3.04,6.18)));
  for(let index=0;index<14;index++){
    const radius=84+index*9,begin=.04+Math.sin(t*.23+index)*.14;
    withAlpha(context,.76-index*.035,()=>path(context,index%3?middle:shine,index%5===0?3.6:1,p=>p.ellipse(0,9,radius,radius*.31,0,begin,begin+Math.PI*.96)));
  }
  context.restore();
}
function eclipse(context,state){
  const {base,sky,middle,foreground,shine,t}=state;
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.61,base],[1,foreground]]));
  stars(context,state,84);
  const x=782,y=229,radius=122;
  wash(context,x,y,224,212,middle,.63,.19);
  wash(context,x+72,y-68,162,128,shine,.38,.04,-.35);
  ellipse(context,x,y,radius+3.4,radius+3.4,shine);
  ellipse(context,x-5,y+6,radius,radius,foreground);
  for(let index=0;index<3;index++){
    const a=-1.29+index*.21+Math.sin(t*.2)*.035;
    withAlpha(context,.54-index*.12,()=>path(context,shine,2.6-index*.5,p=>p.arc(x,y,radius+6+index*3,a,a+.69)));
  }
}

function dunes(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,30,0,H,[[0,sky],[.52,base],[1,middle]]));
  plane(context,[[0,449],[254,332],[444,349],[587,404],[765,332],[1000,351]],middle);
  plane(context,[[0,485],[207,428],[443,439],[680,473],[865,408],[1000,358]],gradient(context,0,393,605,545,[[0,foreground],[.63,middle],[1,base]]));
  plane(context,[[0,442],[170,476],[392,544],[640,556],[891,455],[1000,443]],gradient(context,100,445,740,H,[[0,base],[.72,middle],[1,foreground]]));
  for(let index=0;index<12;index++){
    const y=513+index*11, phase=Math.sin(t*.21)*6;
    withAlpha(context,.24-index*.013,()=>path(context,shine,1.2,p=>{p.moveTo(0,y);p.bezierCurveTo(278,y+34+phase,312,y+112,695,y+50);}));
  }
}
function tree(context,x,y,height,color){
  polygon(context,[[x,y-height],[x-height*.21,y-height*.51],[x-height*.1,y-height*.54],
    [x-height*.31,y-height*.2],[x-height*.13,y-height*.24],[x-height*.39,y],
    [x+height*.35,y],[x+height*.14,y-height*.24],[x+height*.23,y-height*.22],
    [x+height*.07,y-height*.56],[x+height*.16,y-height*.53]],color);
}
function forest(context,{base,sky,middle,foreground,shine,t,rand,quality}){
  rect(context,0,0,W,H,gradient(context,166,85,795,H,[[0,sky],[.55,base],[1,foreground]]));
  wash(context,150,215,280,305,shine,.53,0);
  for(let index=0;index<7;index++){
    const x=206+(index-3)*30+Math.sin(t*.19)*20;
    withAlpha(context,.071,()=>polygon(context,[[x,210],[x+24,208],[925+index*24,542+index*26],[849+index*21,518+index*25]],shine));
  }
  for(let index=0;index<22*quality+9;index++){
    const x=rand(index*3)*W,y=H-8-rand(index*3+1)*156;
    tree(context,x,y,43+rand(index*3+2)*103,index%3?middle:foreground);
  }
  for(const [x,w] of [[24,34],[114,18],[947,27],[988,31]]){
    polygon(context,[[x,0],[x+w,0],[x+w*.67,H],[x-w*.66,H]],foreground);
  }
  plane(context,[[0,579],[149,544],[362,591],[684,568],[1000,530]],foreground);
}
function meadow(context,state){
  const {base,sky,middle,foreground,shine,t,rand,quality}=state;
  skyGradient(context,state);
  wash(context,335,280,407,205,shine,.45,0);
  plane(context,[[0,391],[207,350],[453,406],[675,390],[1000,342]],middle);
  plane(context,[[0,474],[186,452],[414,473],[689,519],[1000,414]],gradient(context,0,430,0,H,[[0,base],[1,foreground]]));
  for(let index=0;index<160*quality;index++){
    const seed=index*5,x=rand(seed)*W,y=504+rand(seed+1)*128;
    const height=4+rand(seed+2)*34, sweep=Math.sin(t*.55+rand(seed+3)*8)*4;
    withAlpha(context,.62,()=>path(context,foreground,1,p=>{p.moveTo(x,y);p.quadraticCurveTo(x+1,y-height*.6,x+sweep,y-height);}));
    if(index%5<2)ellipse(context,x+sweep,y-height,1.4+rand(seed+4)*2.6,1.7,index%5===0?shine:'#f0dbaa');
  }
}
function peaks(context,state){
  const {base,middle,foreground,shine}=state;
  skyGradient(context,state);
  const silhouette=[[0,468],[121,357],[191,396],[350,227],[434,340],[522,271],[588,328],[742,180],[1000,441]];
  plane(context,silhouette,middle,false);
  polygon(context,[[350,227],[434,340],[388,308],[367,321],[348,274],[285,330]],shine);
  polygon(context,[[522,271],[588,328],[559,310],[539,324],[516,292],[484,314]],shine);
  polygon(context,[[742,180],[889,333],[803,274],[754,281],[725,241],[678,252]],shine);
  polygon(context,[[742,180],[785,298],[876,405],[798,441],[950,459],[1000,441]],foreground);
  plane(context,[[0,512],[204,433],[339,490],[612,525],[834,487],[1000,493]],base);
}
function river(context,{base,sky,middle,foreground,shine,t,rand,quality}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.62,base],[1,foreground]]));
  for(let index=0;index<40*quality+6;index++){
    const x=rand(index*2)*W,y=rand(index*2+1)*H;
    withAlpha(context,.17,()=>ellipse(context,x,y,9+rand(index+38)*41,5+rand(index+41)*20,index%3?foreground:shine,-.18));
  }
  function bank(p){
    p.moveTo(322,-46);p.bezierCurveTo(609,77,151,158,270,287);
    p.bezierCurveTo(424,414,849,372,794,485);p.bezierCurveTo(762,550,546,552,503,668);
  }
  path(context,foreground,129,bank);
  path(context,middle,105,bank);
  withAlpha(context,.69,()=>path(context,shine,2.25,p=>{
    const d=Math.sin(t*.31)*13;
    p.moveTo(311,-40);p.bezierCurveTo(575,76,121+d,165,244,291);p.bezierCurveTo(389,415,850,381+d,768,488);p.bezierCurveTo(719,547,522+d,550,480,663);
  }));
}
function cliffs(context,state){
  const {base,sky,middle,foreground,shine}=state;
  skyGradient(context,state);
  const ledges=[[0,130],[164,156],[224,230],[304,246],[346,355],[378,382],[416,620],[0,620]];
  polygon(context,ledges,foreground);
  polygon(context,[[0,181],[154,193],[195,256],[285,275],[301,365],[340,397],[378,620],[0,620]],middle);
  polygon(context,[[0,274],[130,306],[163,355],[252,380],[279,467],[320,505],[346,620],[0,620]],sky);
  for(let index=0;index<12;index++){
    const y=286+index*22;
    withAlpha(context,.32,()=>path(context,foreground,2,p=>{p.moveTo(0,y);p.lineTo(93,y+11);p.lineTo(147+index*8,y+29);}));
  }
  plane(context,[[0,585],[287,546],[448,588],[775,519],[1000,535]],base);
  wash(context,743,150,300,210,shine,.33,0);
}
function fjord(context,state){
  const {base,sky,middle,foreground,shine,t}=state;
  skyGradient(context,state);
  polygon(context,[[0,221],[129,117],[235,180],[310,299],[473,418],[258,430],[0,485]],foreground);
  polygon(context,[[630,393],[785,274],[856,166],[1000,203],[1000,465],[893,449]],middle);
  plane(context,[[0,467],[234,426],[500,414],[798,438],[1000,459]],gradient(context,0,422,0,H,[[0,sky],[.45,base],[1,middle]]));
  for(let index=0;index<9;index++){
    const y=442+index*23,x=483+Math.sin(t*.28+index)*46;
    withAlpha(context,.36-index*.027,()=>path(context,shine,1.4,p=>{p.moveTo(x-index*35,y);p.lineTo(x+116+index*27,y+1);}));
  }
}
function cedarLake(context,state){
  const {base,sky,middle,foreground,shine,t,rand,quality}=state;
  skyGradient(context,state);
  wash(context,272,206,255,147,shine,.39,0);
  rect(context,0,333,W,287,gradient(context,0,333,0,H,[[0,middle],[.44,base],[1,foreground]]));
  for(let index=0;index<51*quality+13;index++){
    const x=rand(index*3)*W, height=26+rand(index*3+1)*111;
    tree(context,x,345,height*(x<390||x>840?1:.25),index%3===0?middle:foreground);
    withAlpha(context,.19,()=>{
      context.save();context.translate(0,690);context.scale(1,-1);
      tree(context,x,345,height*.52,foreground);context.restore();
    });
  }
  for(let index=0;index<12;index++){
    const y=373+index*16,x=rand(202+index)*W;
    withAlpha(context,.15,()=>path(context,shine,1,p=>{p.moveTo(x+Math.sin(t*.31+index)*12,y);p.lineTo(x+60+rand(index)*131,y);}));
  }
}
function terraces(context,state){
  const {base,middle,foreground,shine}=state;
  skyGradient(context,state);
  for(let index=0;index<10;index++){
    const y=240+index*47,fold=(index-4)*19;
    const points=[[0,y-93],[142,y-130],[304+fold,y-32],[488+fold,y+6],[708,y-42],[1000,y-8]];
    plane(context,points,index%3===0?middle:index%3===1?base:foreground);
    withAlpha(context,.39,()=>path(context,shine,2.4,p=>{
      p.moveTo(0,y-93);p.bezierCurveTo(133,y-150,182+fold,y-109,304+fold,y-32);
      p.bezierCurveTo(565+fold,y+64,637,y-98,1000,y-8);
    }));
  }
}
function sunset(context,state){
  const {base,sky,middle,foreground,shine,t}=state;
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,foreground],[.39,sky],[.68,middle],[.72,base],[1,foreground]]));
  wash(context,205,422,303,84,shine,.33,0);
  ellipse(context,204,406,42,42,middle);
  rect(context,0,430,W,190,gradient(context,0,430,0,H,[[0,base],[1,foreground]]));
  for(let index=0;index<16;index++){
    const y=433+index*9,span=23+index*5,x=204+Math.sin(t*.46+index)*27;
    withAlpha(context,.38-index*.015,()=>path(context,shine,1.15,p=>{p.moveTo(x-span,y);p.lineTo(x+span,y);}));
  }
}

function riverRain(context,state){
  const {base,sky,middle,foreground,shine,t,rand,quality}=state;
  skyGradient(context,state);
  plane(context,[[0,205],[96,256],[181,299],[276,275],[370,348],[551,360],[790,270],[1000,238]],middle);
  rect(context,0,368,W,252,gradient(context,0,368,0,H,[[0,base],[1,middle]]));
  polygon(context,[[697,459],[833,455],[796,471],[730,475]],foreground);
  polygon(context,[[715,451],[746,430],[778,430],[808,452]],foreground);
  for(let index=0;index<90*quality;index++){
    const x=rand(index*3)*W,y=(rand(index*3+1)*H+t*63)%H;
    withAlpha(context,.17+rand(index*3+2)*.25,()=>path(context,shine,1,p=>{p.moveTo(x,y);p.lineTo(x-4,y+23);}));
  }
  wash(context,469,350,488,86,sky,.54,0);
}
function current(context,state){
  const {base,sky,middle,foreground,shine,t}=state;
  rect(context,0,0,W,H,gradient(context,0,H,W,0,[[0,foreground],[.54,base],[1,sky]]));
  for(let index=0;index<14;index++){
    const y=98+index*36,tide=Math.sin(t*.48+index*.22)*35;
    withAlpha(context,.32-index*.012,()=>path(context,index%3?middle:shine,index%3?14:1.8,p=>{
      p.moveTo(0,y+148);p.bezierCurveTo(236,y-51+tide,388,y+230,694,y+31-tide);
      p.quadraticCurveTo(862,y-96,W,y+5+tide*.37);
    }));
  }
}
function ripples(context,state){
  const {base,middle,foreground,shine,t}=state;
  skyGradient(context,state);
  rect(context,0,324,W,296,gradient(context,0,324,0,H,[[0,base],[.67,middle],[1,foreground]]));
  for(const [cx,cy,lag] of [[242,456,0],[803,532,1.3]]){
    for(let index=0;index<7;index++){
      const progress=((t*.082+index/7+lag)%1), radius=9+progress*245;
      withAlpha(context,(1-progress)*.49,()=>path(context,index%3?shine:foreground,1.7,p=>p.ellipse(cx,cy,radius,radius*.28,0,0,TAU)));
    }
    ellipse(context,cx,cy,3,2,shine);
  }
}
function fog(context,state){
  const {base,middle,foreground,shine,t}=state;
  skyGradient(context,state);
  plane(context,[[0,420],[213,361],[410,434],[674,398],[895,436],[1000,403]],foreground);
  plane(context,[[0,490],[179,478],[450,518],[710,446],[1000,501]],middle);
  for(let index=0;index<7;index++){
    const x=40+index*174+Math.cos(t*.26+index*.56)*62;
    const y=345+index*34+Math.sin(index*2.2)*63;
    wash(context,x,y,390,53,index%2?base:shine,.76,0,-.075);
  }
}
function squall(context,state){
  const {base,sky,middle,foreground,shine,rand,t,quality}=state;
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,sky],[.38,base],[1,foreground]]));
  for(let index=0;index<6;index++)wash(context,index*197,116-index*12,268,68,middle,.37,0,-.14);
  plane(context,[[0,554],[223,512],[424,551],[762,498],[1000,541]],foreground);
  for(let index=0;index<102*quality+25;index++){
    const seed=index*4, speed=138+rand(seed+2)*128,y=(rand(seed)*790+t*speed)%790-81;
    const x=(rand(seed+1)*1115+790-((t*speed*.5)%790))%1115;
    const length=19+rand(seed+3)*60;
    withAlpha(context,x>330&&x<813?.58:.86,()=>path(context,gradient(context,x,y,x-length*.51,y+length,[[0,'#0000'],[1,shine]]),.65+rand(seed)*.8,p=>{p.moveTo(x,y);p.lineTo(x-length*.51,y+length);}));
  }
}
function tide(context,state){
  const {base,sky,middle,foreground,shine,t}=state;
  rect(context,0,0,W,H,gradient(context,W,0,0,H,[[0,base],[.66,middle],[1,foreground]]));
  const x=32,y=H+63;
  for(let index=0;index<11;index++){
    const span=(index*71+t*19)%805+35;
    withAlpha(context,.31*(1-span/950),()=>path(context,index%3===0?sky:shine,2.1,p=>p.ellipse(x,y,span*1.12,span*.78,-.34,Math.PI,TAU)));
  }
  wash(context,50,594,327,154,shine,.4,0,-.42);
}
function caustics(context,state){
  const {base,sky,middle,foreground,shine,t,rand}=state;
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.52,base],[1,middle]]));
  for(let row=0;row<7;row++) for(let col=0;col<11;col++){
    const index=row*11+col,x=col*102-25,y=row*107-22;
    const jitter=Math.sin(t*.7+index*.76),rx=27+rand(index+120)*32,ry=12+rand(index+250)*39;
    withAlpha(context,(x>320&&x<840?.32:.61),()=>path(context,index%3?shine:foreground,1.5,p=>{
      p.moveTo(x-rx,y+4+jitter*4);p.bezierCurveTo(x-rx*.83,y-ry,x+rx*.82,y-ry*.86,x+rx,y+jitter*8);
      p.bezierCurveTo(x+rx*.61,y+ry,x-rx*.64,y+ry*.94,x-rx,y+4+jitter*4);
    }));
  }
}
function waterlines(context,state){
  const {base,sky,middle,foreground,shine,t}=state;
  skyGradient(context,state);
  context.beginPath();context.moveTo(0,387);context.bezierCurveTo(293,306,430,502,678,444);
  context.bezierCurveTo(822,402,931,387,W,404);context.lineTo(W,H);context.lineTo(0,H);context.closePath();
  context.fillStyle=gradient(context,0,416,W,H,[[0,sky],[.58,middle],[1,base]]);context.fill();
  for(let index=0;index<8;index++){
    const y=377+index*18,d=Math.sin(t*.37+index*.62)*(index*1.3+4);
    withAlpha(context,.49-index*.026,()=>path(context,index%3?foreground:shine,1+index*.26,p=>{
      p.moveTo(0,y+d);p.bezierCurveTo(239,y-77,453,y+110,679,y+59-d);p.quadraticCurveTo(876,y+7,W,y+20);
    }));
  }
  for(let index=0;index<4;index++){
    const y=541+index*14,d=Math.sin(t*.38+index)*6;
    withAlpha(context,.47,()=>path(context,shine,1.3,p=>{p.moveTo(0,y);p.bezierCurveTo(133,y+26,316+d,y+43,500,y-10);}));
  }
}
function ice(context,state){
  const {base,sky,middle,foreground,shine,rand}=state;
  skyGradient(context,state);
  for(let index=0;index<21;index++){
    const x=rand(index*4)*W,y=rand(index*4+1)*H,spread=32+rand(index*4+2)*151;
    const vertices=[[x,y],[x+spread*.66,y-spread*.7],[x+spread,y+spread*.32],[x+spread*.56,y+spread*.86],[x-spread*.52,y+spread*.49]];
    withAlpha(context,x>340&&x<830?.19:.33,()=>{
      polygon(context,vertices,index%3?middle:shine);
      path(context,foreground,1.1,p=>{p.moveTo(...vertices[4]);p.lineTo(...vertices[0]);p.lineTo(...vertices[1]);p.moveTo(...vertices[0]);p.lineTo(...vertices[2]);});
    });
  }
}
function paperGround(context,{base,sky,middle,foreground,rand,quality}){
  rect(context,0,0,W,H,gradient(context,0,50,W,H,[[0,sky],[.58,base],[1,middle]]));
  // Paper grain is deterministic so still presets and snapshots keep the same texture.
  withAlpha(context,.11,()=>{
    context.fillStyle=foreground;
    for(let index=0;index<1000*quality+350;index++){
      const x=rand(index*3)*W,y=rand(index*3+1)*H;
      context.fillRect(x,y,.75+rand(index*3+2)*1.35,.7);
    }
  });
}
function ink(context,state){
  const {base,sky,middle,foreground,shine,t,rand}=state;
  paperGround(context,{...state,middle:base});
  for(let index=0;index<22;index++){
    const x=110+rand(index*4)*263,y=452+rand(index*4+1)*155;
    const spread=1+Math.sin(t*.25+index)*.075;
    wash(context,x,y,(64+rand(index*4+2)*127)*spread,(26+rand(index*4+3)*85)*spread,
      index%4===0?shine:index%3?foreground:middle,index%3?.35:.26,0,-.23);
  }
  wash(context,640,524,283,58,base,.6,0);
}
function torn(context,state){
  const {base,middle,foreground,shine,rand}=state;
  paperGround(context,{...state,middle:base});
  for(let layer=0;layer<4;layer++){
    const points=Array.from({length:112},(_,index)=>{
      const x=index*W/111,y=332+layer*75+Math.sin(index*.046+layer*1.8)*56+Math.sin(index*.161)*12;
      return [x,y+rand(index+layer*125)*8];
    });
    withAlpha(context,.23,()=>plane(context,points.map(([x,y])=>[x,y+5]),foreground,false));
    plane(context,points,layer%3===0?middle:layer%3===1?base:foreground,false);
    withAlpha(context,.67,()=>path(context,shine,2.2,p=>points.forEach(([x,y],index)=>index?p.lineTo(x,y):p.moveTo(x,y))));
  }
}
function screen(context,state){
  const {base,sky,middle,foreground,shine}=state;
  paperGround(context,{...state,middle:base});
  withAlpha(context,.84,()=>{
    polygon(context,[[98,170],[249,119],[311,332],[152,376]],middle);
    polygon(context,[[144,371],[315,269],[398,417],[228,516]],foreground);
    polygon(context,[[802,401],[913,363],[967,505],[854,550]],shine);
  });
  context.save();
  context.beginPath();context.rect(55,85,359,443);context.clip();
  withAlpha(context,.19,()=>{
    for(let index=0;index<79;index++){
      const y=95+index*5.5;
      path(context,sky,1,p=>{p.moveTo(0,y+38);p.lineTo(418,y-13);});
    }
  });
  context.restore();
}
function overprint(context,state){
  const {base,middle,foreground,shine}=state;
  paperGround(context,{...state,middle:base});
  withAlpha(context,.7,()=>{
    context.save();context.translate(143,314);context.rotate(-.16);
    for(let index=0;index<8;index++){
      rect(context,index*19,-179,9,322,middle);
      rect(context,index*19+6,-174,8,322,foreground);
      rect(context,-51,139+index*14,302,5,index%2?middle:shine);
    }
    context.restore();
    context.save();context.translate(890,146);context.rotate(.27);
    for(let index=0;index<5;index++)rect(context,index*17,-160,6,287,index%2?foreground:middle);
    context.restore();
  });
}
function charcoal(context,state){
  const {base,middle,foreground,shine,rand,quality}=state;
  paperGround(context,{...state,middle:base});
  for(let index=0;index<1000*quality+360;index++){
    const x=rand(index*4)*W,y=H-rand(index*4+1)*(x<400?219-x*.32:119+Math.max(0,x-730)*.36);
    const alpha=.13+rand(index*4+2)*.19;
    withAlpha(context,alpha,()=>rect(context,x,y,1+rand(index*4+3)*16,1+rand(index+850)*4,index%5===0?shine:index%3?foreground:middle));
  }
  for(const [x,y,h,w] of [[105,523,103,113],[177,542,63,103],[888,566,74,92],[975,547,106,104]]){
    withAlpha(context,.61,()=>polygon(context,[[x-w,y+29],[x-w*.46,y-h*.72],[x+w*.12,y-h],[x+w*.55,y-h*.64],[x+w,y+21]],foreground));
    withAlpha(context,.42,()=>path(context,shine,2.1,p=>{p.moveTo(x-w*.46,y-h*.72);p.lineTo(x+w*.12,y-h);p.lineTo(x+w*.25,y-h*.59);}));
  }
}
function paperFan(context,state){
  const {base,sky,middle,foreground,shine}=state;
  paperGround(context,{...state,middle:base});
  const x=105,y=682;
  for(let index=0;index<13;index++){
    const angle=-2.31+index*.15,next=angle+.15;
    const edge=[x+Math.cos(angle)*675,y+Math.sin(angle)*675];
    const far=[x+Math.cos(next)*667,y+Math.sin(next)*667];
    const fold=gradient(context,edge[0],edge[1],far[0],far[1],[[0,middle],[.47,index%2?sky:shine],[.93,base],[1,foreground]]);
    polygon(context,[[x,y],edge,far],fold);
  }
  wash(context,x,y,248,174,foreground,.32,0);
}
function inkHills(context,state){
  const {base,sky,middle,foreground,shine}=state;
  paperGround(context,{...state,middle:base});
  wash(context,719,156,187,80,shine,.30,0);
  plane(context,[[0,378],[112,311],[235,378],[334,402],[450,351],[590,424],[790,312],[1000,399]],middle);
  plane(context,[[0,502],[137,434],[280,505],[570,529],[785,452],[1000,488]],gradient(context,0,459,0,H,[[0,sky],[1,middle]]));
  for(const [x,y,h] of [[69,565,92],[117,581,71],[171,597,49],[905,517,68],[948,528,54]]){
    withAlpha(context,.74,()=>tree(context,x,y,h,foreground));
  }
}
function halftone(context,state){
  const {base,middle,foreground,shine}=state;
  paperGround(context,{...state,middle:base});
  for(let y=19;y<H;y+=13){
    for(let x=16;x<W;x+=13){
      const diagonal=y-x*.47;
      const field=Math.max(0,1-Math.abs(diagonal-350)/163,1-Math.abs(x+y*.23-152)/155);
      if(field<.21)continue;
      withAlpha(context,.37+field*.22,()=>ellipse(context,x+(y%2)*5,y,field*5.2,field*5.2,x<266?foreground:middle));
    }
  }
  withAlpha(context,.54,()=>polygon(context,[[82,466],[289,385],[316,441],[107,521]],shine));
}
function stencil(context,state){
  const {base,middle,foreground,shine}=state;
  paperGround(context,{...state,middle:base});
  withAlpha(context,.78,()=>{
    polygon(context,[[23,233],[156,104],[253,110],[246,282],[70,354]],middle);
    polygon(context,[[55,358],[174,277],[235,323],[262,502],[196,470],[84,533]],foreground);
    polygon(context,[[0,364],[125,444],[95,563],[0,535]],shine);
    polygon(context,[[819,577],[914,467],[1000,454],[1000,H],[840,H]],middle);
  });
  polygon(context,[[62,370],[129,353],[143,372],[94,436],[87,408]],base);
}

function shafts(context,{base,sky,middle,foreground,shine,t,energy}){
  rect(context,0,0,W,H,gradient(context,20,0,W,H,[[0,sky],[.53,base],[1,foreground]]));
  const x=187+Math.sin(t*.22)*16;
  for(let index=0;index<5;index++){
    const a=x+index*33,b=x+index*97+370;
    const beam=gradient(context,a,44,b,526,[[0,shine],[.57,middle],[1,'#0000']]);
    withAlpha(context,.37+energy*.13-index*.035,()=>polygon(context,[[a,0],[a+17,0],[b+98,578],[b-18,575]],beam));
  }
  rect(context,102,0,18,269,foreground);
  rect(context,350,0,9,219,foreground);
  rect(context,105,132,247,4,foreground);
}
function silk(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,base],[.55,sky],[1,middle]]));
  for(let index=0;index<10;index++){
    const y=58+index*56,wave=Math.sin(t*.43+index*.62)*45;
    const sheen=gradient(context,0,y,678,y+95,[[0,foreground],[.39,middle],[.64,shine],[1,'#0000']]);
    withAlpha(context,index%3===0?.5:.38,()=>path(context,sheen,10+index*2,p=>{
      p.moveTo(-32,y+152);p.bezierCurveTo(230,y-177+wave,366,y+221-wave,684,y+32);
      p.bezierCurveTo(794,y-65,964,y+15,W,y+wave*.53);
    }));
  }
}
function glass(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.52,base],[1,middle]]));
  const offset=Math.sin(t*.22)*13;
  const pieces=[
    [[-68,29],[243,65],[289,293],[12,234]],
    [[-43,296],[242,228],[365,469],[51,525]],
    [[179,620],[282,417],[421,378],[544,620]],
    [[802,118],[986,25],[1035,323],[861,380]],
    [[723,483],[874,342],[1000,339],[1018,604]],
  ];
  pieces.forEach((vertices,index)=>{
    const points=vertices.map(([x,y])=>[x+offset*(index%2?1:-1),y]);
    const glass=gradient(context,points[0][0],points[0][1],points[2][0],points[2][1],[[0,shine],[.63,index%2?middle:sky],[1,foreground]]);
    withAlpha(context,.55,()=>polygon(context,points,glass));
    withAlpha(context,.68,()=>path(context,shine,2,p=>{p.moveTo(...points[3]);p.lineTo(...points[0]);p.lineTo(...points[1]);}));
  });
}
function slits(context,{base,sky,middle,foreground,shine,t,energy}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.43,base],[1,foreground]]));
  const bias=Math.sin(t*.2)*16;
  for(let index=0;index<13;index++){
    const x=31+index*79;
    rect(context,x,0,15,H,foreground);
    const line=gradient(context,x,44,x,583,[[0,'#0000'],[.33,shine],[.68,middle],[1,'#0000']]);
    withAlpha(context,(x>370&&x<825?.38:.63)+energy*.16,()=>rect(context,x+15,0,3+index%4,H,line));
    if(index<4)wash(context,x+19,266+bias,47,301,middle,.28+energy*.14,0);
  }
}
function metal(context,{base,sky,middle,foreground,shine,t,energy,rand}){
  const angle=Math.sin(t*.23)*53+energy*42;
  rect(context,0,0,W,H,gradient(context,178+angle,0,794+angle,H,[[0,foreground],[.19,middle],[.27,sky],[.44,base],[.54,shine],[.66,sky],[.88,middle],[1,foreground]]));
  context.save();context.translate(450,270);context.rotate(-.32);
  withAlpha(context,.20,()=>{
    for(let index=0;index<165;index++){
      const y=-460+index*5.3,x=-764+rand(index)*187;
      rect(context,x,y,1430+rand(index+180)*161,.7+rand(index+365)*1.35,index%5?foreground:shine);
    }
  });
  context.restore();
}
function liquid(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.46,base],[1,middle]]));
  for(const [x,y,rx,ry,angle] of [[62,245,165,167,.3],[276,525,267,110,-.37],[904,160,140,186,.62],[988,507,184,90,-.2]]){
    const d=Math.sin(t*.38+x)*24,round=1+Math.cos(t*.27+x)*.045;
    const edge=gradient(context,x-rx,y-ry,x+rx,y+ry,[[0,shine],[.29,sky],[.64,middle],[1,foreground]]);
    withAlpha(context,.69,()=>ellipse(context,x+d,y,rx*round,ry,edge,angle));
    wash(context,x+d-35,y-18,rx*.82,ry*.81,base,.78,0,angle);
    withAlpha(context,.77,()=>path(context,shine,2.7,p=>p.ellipse(x+d,y,rx*round,ry,angle,3.62,5.14)));
  }
}
function rails(context,{base,sky,middle,foreground,shine,t,energy}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,foreground],[.52,base],[1,sky]]));
  for(let lane=0;lane<8;lane++){
    const y=138+lane*58,spot=(t*(46+lane*11)+lane*147)%1397-170;
    const ribbon=gradient(context,spot-150,y,spot+144,y-117,[[0,'#0000'],[.59,middle],[.84,shine],[1,'#0000']]);
    withAlpha(context,.42+energy*.13,()=>path(context,ribbon,lane%3===0?5:2,p=>{p.moveTo(-70,y+105);p.lineTo(1070,y-346);}));
  }
  for(let index=0;index<6;index++){
    withAlpha(context,.15,()=>path(context,shine,1,p=>{p.moveTo(-100,300+index*105);p.lineTo(W,100+index*39);}));
  }
}
function frost(context,{base,sky,middle,foreground,shine,t,rand,quality}){
  rect(context,0,0,W,H,gradient(context,W,0,0,H,[[0,sky],[.37,base],[1,foreground]]));
  const drift=Math.sin(t*.16)*22;
  withAlpha(context,.38,()=>polygon(context,[[0,0],[367+drift,0],[144+drift,H],[0,H]],
    gradient(context,0,383,355,195,[[0,foreground],[.53,middle],[1,shine]])));
  withAlpha(context,.34,()=>polygon(context,[[920+drift,0],[W,0],[W,H],[698+drift,H]],
    gradient(context,732,H,969,0,[[0,shine],[.55,middle],[1,sky]])));
  context.save();
  const brightness=gradient(context,0,0,W,0,[[0,shine],[.35,'#0000'],[.69,'#0000'],[1,shine]]);
  context.globalAlpha*=.31;context.fillStyle=brightness;
  for(let index=0;index<620*quality+255;index++){
    const x=rand(index*4)*W,y=rand(index*4+1)*H,size=.6+rand(index*4+2)*2.3;
    context.fillRect(x,y,size,size*.77);
  }
  context.restore();
  wash(context,978,254,118,318,shine,.28,0);
}
function folds(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.56,base],[1,middle]]));
  for(let index=0;index<6;index++){
    const bend=Math.sin(t*.26+index)*26,x=91+index*192;
    const fabric=gradient(context,x-130,0,x+132,H,[[0,index%2?sky:shine],[.56,base],[1,middle]]);
    context.beginPath();context.moveTo(x-60,0);
    context.bezierCurveTo(x+127,208,x-161+bend,388,x-13,H);
    context.lineTo(x+122,H);context.bezierCurveTo(x-25+bend,404,x+244,225,x+115,0);
    context.closePath();context.fillStyle=fabric;context.fill();
  }
}
function neon(context,{base,sky,middle,foreground,shine,t,energy}){
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,base],[.56,sky],[1,foreground]]));
  const vanX=405, vanY=330;
  for(let index=-5;index<13;index++){
    const x=vanX+index*166;
    withAlpha(context,.35+energy*.1,()=>path(context,index%4?middle:shine,1.3,p=>{p.moveTo(vanX+index*12,vanY);p.lineTo(x,H);}));
  }
  for(let index=0;index<13;index++){
    const progress=(index/13+t*.22)%1,y=vanY+(H-vanY)*progress*progress;
    withAlpha(context,.16+progress*.32,()=>path(context,index%5?middle:shine,1.2,p=>{p.moveTo(0,y);p.lineTo(W,y);}));
  }
  for(let index=0;index<13;index++){
    const x=index<8?index*47:(index+6)*47, y=vanY-14-(index*29%69);
    rect(context,x,y,35,vanY-y,base);
    withAlpha(context,.49+energy*.12,()=>rect(context,x,y+18,2,vanY-y-20,shine));
  }
}
function prism(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.5,base],[1,foreground]]));
  const vanX=802,vanY=333;
  polygon(context,[[0,0],[W,0],[vanX,vanY],[0,510]],foreground);
  for(let index=0;index<10;index++){
    const d=(index/10+t*.047)%1,span=49+d*d*1051;
    const points=[[vanX-span,vanY+span*.15],[vanX+span*.43,vanY-span*.65],[vanX+span*.59,vanY+span*.51]];
    withAlpha(context,.22+d*.25,()=>path(context,index%4?middle:shine,1.6,p=>{
      p.moveTo(...points[0]);p.lineTo(...points[1]);p.lineTo(...points[2]);p.closePath();
    }));
  }
}
function lanterns(context,{base,sky,middle,foreground,shine,t,energy}){
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,foreground],[.59,base],[1,foreground]]));
  rect(context,0,129,W,183,gradient(context,0,0,W,0,[[0,sky],[.55,base],[1,middle]]));
  for(let index=0;index<9;index++){
    const x=31+index*117,y=142+index*9;
    rect(context,x,y,87,125,foreground);
    wash(context,x+43,y+52,69,129,shine,.34+energy*.16+Math.sin(t*.36+index)*.035,0);
    withAlpha(context,.54+energy*.15,()=>rect(context,x+19,y+25,49,72,shine));
    rect(context,x+41,y+24,3,74,foreground);
    rect(context,x+17,y+59,54,3,foreground);
  }
  rect(context,0,310,W,11,middle);
}
function vault(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.43,base],[1,foreground]]));
  const center=206,vertical=319;
  for(let index=7;index>=0;index--){
    const depth=(index+1)/8, size=31+depth*depth*650;
    const face=Array.from({length:6},(_,side)=>{
      const a=TAU*side/6;
      return [center+Math.cos(a)*size,vertical+Math.sin(a)*size*.82];
    });
    const light=gradient(context,0,0,W,H,[[0,sky],[.4,index%2?base:middle],[1,foreground]]);
    polygon(context,face,light);
    withAlpha(context,(.26+Math.sin(t*.25+index)*.065),()=>path(context,shine,3*.44+index*.16,p=>{
      face.forEach(([x,y],idx)=>idx?p.lineTo(x,y):p.moveTo(x,y));p.closePath();
    }));
  }
}
function lattice(context,{base,sky,middle,foreground,shine}){
  rect(context,0,0,W,H,gradient(context,W,0,0,H,[[0,sky],[.52,base],[1,middle]]));
  for(const edge of [0,W-177]){
    rect(context,edge,0,177,H,middle);
    context.save();context.beginPath();context.rect(edge,0,177,H);context.clip();
    for(let index=-4;index<15;index++){
      const y=index*53;
      withAlpha(context,.57,()=>path(context,foreground,2.1,p=>{
        p.moveTo(edge,y);p.lineTo(edge+177,y+170);p.moveTo(edge,y+170);p.lineTo(edge+177,y);
      }));
    }
    rect(context,edge+87,0,2,H,shine);
    context.restore();
  }
}
function draft(context,{base,sky,middle,foreground,shine}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.49,base],[1,foreground]]));
  withAlpha(context,.28,()=>{
    path(context,middle,1,p=>{
      for(let x=25;x<W;x+=29){p.moveTo(x,0);p.lineTo(x,H);}
      for(let y=25;y<H;y+=29){p.moveTo(0,y);p.lineTo(W,y);}
    });
    path(context,shine,1.6,p=>{
      const vx=819,vy=216;
      for(let index=0;index<17;index++){p.moveTo(vx,vy);p.lineTo(index*72,H);}
      for(let index=0;index<9;index++){const y=vy+index*index*6;p.moveTo(0,y);p.lineTo(W,y);}
    });
  });
  path(context,middle,1.6,p=>{p.moveTo(24,567);p.lineTo(24,587);p.lineTo(327,587);p.lineTo(327,567);});
}
function steps(context,{base,sky,middle,foreground,shine}){
  rect(context,0,0,W,H,gradient(context,0,24,W,H,[[0,sky],[.57,base],[1,middle]]));
  for(let index=0;index<8;index++){
    const x=903-index*107,y=186+index*56;
    polygon(context,[[x,y],[x+168,y-36],[x+237,y-6],[x+67,y+33]],shine);
    polygon(context,[[x,y],[x+67,y+33],[x+67,y+62],[x,y+29]],middle);
    polygon(context,[[x+67,y+33],[x+237,y-6],[x+237,y+23],[x+67,y+62]],foreground);
  }
}
function atrium(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,sky);
  polygon(context,[[0,0],[W,0],[755,130],[182,158]],base);
  polygon(context,[[0,0],[182,158],[182,409],[0,620]],middle);
  polygon(context,[[1000,0],[755,130],[755,384],[1000,H]],middle);
  polygon(context,[[0,H],[182,409],[755,384],[1000,H]],foreground);
  polygon(context,[[182,158],[755,130],[755,384],[182,409]],sky);
  const slide=Math.sin(t*.19)*40;
  withAlpha(context,.65,()=>polygon(context,[[281+slide,474],[535+slide,433],[761+slide,522],[463+slide,576]],shine));
  for(let index=0;index<4;index++)rect(context,199+index*138,151,4,35,foreground);
}
function bays(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.52,base],[1,foreground]]));
  context.save();context.translate(516,325);context.rotate(.32);
  for(let index=0;index<9;index++){
    const x=-570+index*150,y=(index%2?65:-129)+Math.sin(t*.12)*6;
    rect(context,x,y,118,132,foreground);
    rect(context,x+7,y+6,104,118,gradient(context,x,y,x+120,y+132,[[0,middle],[.83,base],[1,sky]]));
    rect(context,x+5,y+111,105,5,shine);
  }
  context.restore();
}
function split(context,{base,sky,middle,foreground,shine}){
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,sky],[.59,base],[1,middle]]));
  rect(context,0,0,204,H,gradient(context,0,0,204,0,[[0,foreground],[1,base]]));
  rect(context,205,0,1,H,shine);
}
function linen(context,{base,sky,middle,foreground,shine}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.54,base],[1,middle]]));
  withAlpha(context,.26,()=>{
    for(let index=0;index<160;index++){
      const y=index*4.2;
      rect(context,0,y,W,.75,index%4===0?shine:foreground);
    }
  });
}
function diffusion(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.41,base],[1,middle]]));
  const drift=Math.sin(t*.12)*135;
  wash(context,468+drift,-106,659,547,shine,.83,0,.18);
}
function stillHorizon(context,{base,sky,middle,foreground,shine}){
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,base],[.58,sky],[.747,shine],[.75,middle],[1,foreground]]));
}
function quietNight(context,{base,sky,middle,foreground}){
  rect(context,0,0,W,H,gradient(context,0,H,W,0,[[0,foreground],[.27,base],[.68,middle],[1,sky]]));
  rect(context,0,431,W,189,gradient(context,0,431,0,H,[[0,'#0000'],[1,foreground]]));
}
function quietRoom(context,{base,sky,middle,foreground,shine,t}){
  rect(context,0,0,W,H,gradient(context,0,0,W,H,[[0,sky],[.61,base],[1,foreground]]));
  const drift=Math.sin(t*.12)*24, shaft=gradient(context,35,0,496,551,[[0,shine],[.63,middle],[1,'#0000']]);
  withAlpha(context,.44,()=>polygon(context,[[16+drift,0],[149+drift,0],[461+drift,485],[392+drift,553]],shaft));
}
function quietLine(context,{base,sky,middle,foreground,shine}){
  rect(context,0,0,W,H,gradient(context,0,0,0,H,[[0,sky],[.61,base],[1,middle]]));
  withAlpha(context,.68,()=>path(context,foreground,1.6,p=>{
    p.moveTo(0,466);p.bezierCurveTo(182,466,301,488,379,511);p.bezierCurveTo(592,576,806,463,W,470);
  }));
  wash(context,886,553,234,78,shine,.29,0);
}
// Coordinates lie along the photographed foam edge and share the crop used by the image.
const shoreEdge=[[0,.806],[.125,.751],[.25,.702],[.375,.615],[.50,.566],[.625,.532],[.75,.456],[.875,.420],[1,.388]];
function coastOverlay(context,frame,light) {
  const {photoRect:{x,y,width,height},time,quality}=frame;
  const swell=Math.sin(time*.61);
  wash(context,x+width*(.27+Math.sin(time*.18)*.11),y+height*.18,width*.4,height*.28,light,.13,0);
  for(let band=0;band<3;band++){
    const points=shoreEdge.map(([u,v],index)=>[x+u*width,y+(v-.018-band*.026)*height
      +(swell*6+Math.sin(time*.81+index*.61+band*.75)*5)*(1+band*.18)]);
    const opacity=(.56-band*.13)*(.66+.34*Math.sin(time*.74+band*.8));
    withAlpha(context,opacity,()=>path(context,'#f7fffb',Math.max(.85,Math.min(2.2,width/820))*(1-band*.15),p=>{
      const [first,...rest]=points;
      p.moveTo(...first);
      rest.forEach(([px,py],index)=>{
        const [priorX,priorY]=points[index];
        const midX=(priorX+px)*.5;
        p.bezierCurveTo(midX,priorY,midX,py,px,py);
      });
    }));
    if(band>0||quality<.45)continue;
    const glints=18;
    for(let index=0;index<glints;index++){
      const u=(index+.4)/glints;
      const segment=Math.min(points.length-2,Math.floor(u*(points.length-1)));
      const from=points[segment],to=points[segment+1],mix=u*(points.length-1)-segment;
      const px=from[0]+(to[0]-from[0])*mix,py=from[1]+(to[1]-from[1])*mix;
      withAlpha(context,.19+.13*Math.sin(time*.9+index*.9),()=>ellipse(context,px,py,.9+width*.0011,.66,'#fafff9',-.29));
    }
  }
}
function rainOverlay(context,frame,light) {
  const {width,height,time,quality,seed,photoRect,immersive}=frame;
  const narrow=width<700;
  const amount=narrow?18:Math.round(21+quality*13),wrap=height+145;
  const scale=Math.min(width<500?.93:1.25,Math.max(.82,height/800));
  const quietY=height*(narrow&&!immersive?.63:.50);
  wash(context,width*(narrow||immersive?.50:.69),quietY,width*(narrow?.60:.52),
    height*(narrow?.38:.43),'#d8eafa',narrow?.40:.27,.22);
  wash(context,width*.12,height*.12,width*.5,height*.34,light,.11,0);
  for(let index=0;index<amount;index++){
    const nonce=index*7,r=value=>seedUnit(seed,nonce+value);
    const side=r(1), fromLeft=index%2===0;
    const position=fromLeft?.045+side*(narrow?.19:immersive?.24:.39):.79+side*.19;
    const x=width*position;
    const source=(x-photoRect.x)/photoRect.width;
    if((source>.626&&source<.666)||source<.044)continue;
    const velocity=24+r(2)*78;
    const drop=(r(3)*wrap+time*velocity)%wrap-82;
    const radius=(1.1+Math.pow(r(4),1.65)*5.0)*scale;
    const length=(8+r(5)*34)*scale;
    const drift=Math.sin(drop*.017+r(6)*TAU)*radius*.49;
    const tail=gradient(context,x,drop-length,x+drift,drop,[[0,'#0000'],[.48,'#576f8957'],[1,'#688aa2bc']]);
    withAlpha(context,.65+r(0)*.30,()=>{
      path(context,tail,Math.max(.65,radius*.40),p=>{
        p.moveTo(x-drift*.28,drop-length);p.quadraticCurveTo(x,drop-length*.39,x+drift,drop);
      });
      ellipse(context,x+drift,drop,radius*.72,radius*1.14,'#314b6599',-.08);
      ellipse(context,x+drift+radius*.15,drop+radius*.29,radius*.41,radius*.59,'#edf9ffdc',-.17);
      ellipse(context,x+drift-radius*.25,drop-radius*.43,radius*.22,radius*.23,'#fcffff');
    });
  }
}
function photoOverlay(context,preset,frame,light) {
  if(preset.design==='coast')coastOverlay(context,frame,light);
  else rainOverlay(context,frame,light);
  const trim=(frame.brightness-.55)*.25;
  if(Math.abs(trim)>.003)withAlpha(context,Math.abs(trim),()=>rect(context,0,0,frame.width,frame.height,trim>0?'#fff':'#101019'));
}
const painters={
  orbit,nebula,meteors,accretion,eclipse,
  valley,dunes,forest,meadow,peaks,river,cliffs,fjord,cedarLake,terraces,sunset,
  riverRain,current,ripples,fog,squall,tide,caustics,waterlines,ice,
  fibers,ink,torn,screen,overprint,charcoal,paperFan,inkHills,halftone,stencil,
  shafts,silk,glass,slits,metal,liquid,rails,frost,folds,reedGlass,
  neon,prism,lanterns,gallery,vault,lattice,draft,steps,atrium,bays,
  calm,split,linen,diffusion,stillHorizon,quietNight,quietRoom,quietLine,
};

export function paint(context,preset,frame){
  const {colors,cover,style,design,veil}=preset;
  const [base,sky,middle,foreground,highlight]=colors;
  const shine=colorWith(highlight,frame.artwork.primary,cover);
  if(frame.photoRect){
    photoOverlay(context,preset,frame,shine);
    return;
  }
  const t=frame.time,rand=index=>seedUnit(frame.seed,index);
  context.save();context.scale(frame.width/W,frame.height/H);
  try{
    painters[design](context,{base,sky,middle,foreground,shine,t,rand,style,quality:frame.quality,energy:frame.energy});
    // Only busy designs get a local wash in their own ground colour.
    if(veil&&!frame.thumbnail){
      const narrow=frame.width<=700;
      wash(context,narrow||frame.immersive?500:680,narrow&&!frame.immersive?407:310,
        narrow?640:540,narrow?230:250,base,veil,.29);
    }
    const trim=(frame.brightness-.64)*.13;
    if(Math.abs(trim)>.006)withAlpha(context,Math.abs(trim),()=>rect(context,0,0,W,H,trim>0?'#fff':'#101019'));
  }finally{context.restore();}
}
