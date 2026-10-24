/**
 * Approved 1200×800 transparent vector frame overlays.
 * All artwork is local, generated from fixed SVG paths—no remote fetching.
 * Derived from the approved second-round Silver Floral, Golden Celestial,
 * Soft Rounded, Double Line, and Black Knight frame designs.
 * No text/photo/metadata is baked into the overlays.
 */
export function frameArtworkSvg(frame) {
  const W=1200,H=800;
  const defs=`<defs>
  <linearGradient id="silver" x1="0%" y1="0%" x2="70%" y2="100%">
    <stop offset="0" stop-color="#283138"/><stop offset=".12" stop-color="#8F9DA8"/>
    <stop offset=".25" stop-color="#F6FCFF"/><stop offset=".37" stop-color="#89959E"/>
    <stop offset=".49" stop-color="#F8FBFD"/><stop offset=".65" stop-color="#5D6873"/>
    <stop offset=".82" stop-color="#DCE7EA"/><stop offset="1" stop-color="#333C43"/>
  </linearGradient>
  <linearGradient id="silverPetal" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".24" stop-color="#C0CED8"/>
    <stop offset=".56" stop-color="#56636C"/><stop offset=".77" stop-color="#E5F1F4"/>
    <stop offset="1" stop-color="#77868D"/>
  </linearGradient>
  <linearGradient id="gold" x1="0%" y1="0%" x2="83%" y2="87%">
    <stop offset="0" stop-color="#493013"/><stop offset=".1" stop-color="#9E651F"/>
    <stop offset=".23" stop-color="#FFE8A1"/><stop offset=".35" stop-color="#AD751A"/>
    <stop offset=".5" stop-color="#FFF2B7"/><stop offset=".69" stop-color="#BC8023"/>
    <stop offset=".86" stop-color="#F9D875"/><stop offset="1" stop-color="#503618"/>
  </linearGradient>
  <linearGradient id="goldPetal" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFF9DD"/><stop offset=".24" stop-color="#F2C756"/>
    <stop offset=".58" stop-color="#855719"/><stop offset=".76" stop-color="#FFE5A4"/>
    <stop offset="1" stop-color="#AE7228"/>
  </linearGradient>
  <linearGradient id="creamCushion" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFF9EC"/><stop offset=".27" stop-color="#F0E1CD"/>
    <stop offset=".5" stop-color="#DCCBB9"/><stop offset=".73" stop-color="#FFF5E8"/>
    <stop offset="1" stop-color="#AD9689"/>
  </linearGradient>
  <linearGradient id="charcoal" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#485257"/><stop offset=".13" stop-color="#B9C0C2"/>
    <stop offset=".22" stop-color="#353D43"/><stop offset=".44" stop-color="#11181D"/>
    <stop offset=".62" stop-color="#636C70"/><stop offset=".83" stop-color="#1B2329"/>
    <stop offset="1" stop-color="#6B7476"/>
  </linearGradient>
  <radialGradient id="silverJewel">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".22" stop-color="#E5FAFF"/>
    <stop offset=".56" stop-color="#97B1C2"/><stop offset=".76" stop-color="#3B4F60"/>
    <stop offset="1" stop-color="#101D28"/>
  </radialGradient>
  <radialGradient id="goldJewel">
    <stop offset="0" stop-color="#FFFEE4"/><stop offset=".33" stop-color="#FFE49A"/>
    <stop offset=".64" stop-color="#D3A03C"/><stop offset="1" stop-color="#624015"/>
  </radialGradient>
</defs>`;
  const rect=(x,y,w,h,r,color,sw,opacity=1)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="none" stroke="${color}" stroke-width="${sw}" opacity="${opacity}"/>`;
  const ellipse=(x,y,rx,ry,fill,stroke="none",sw=0,transform="")=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="${transform}"/>`;
  const path=(d,stroke,sw=1,fill="none",opacity=1)=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const star=(cx,cy,R,r=2,points=4,fill="url(#gold)",stroke="#FFF2BE",width=1)=>{
    const xy=[];
    for(let i=0;i<points*2;i++){const a=-Math.PI/2+Math.PI*i/points,rr=i%2?r:R;xy.push(`${(cx+rr*Math.cos(a)).toFixed(2)},${(cy+rr*Math.sin(a)).toFixed(2)}`)}
    return `<polygon points="${xy.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  };
  const gleam=(cx,cy,R=12,col="#E9FCFF")=>`<g opacity=".94">${path(`M ${cx-R} ${cy} L ${cx+R} ${cy} M ${cx} ${cy-R} L ${cx} ${cy+R}`,col,1.35)}${star(cx,cy,R*.42,R*.095,4,col,"none",0)}</g>`;
  const medal=(x,y,metal)=>ellipse(x,y,9,9,`url(#${metal==="silver"?"silverJewel":"goldJewel"})`,metal==="silver"?"#34434B":"#6D471F",2)+ellipse(x-2.2,y-2.2,2,2,metal==="silver"?"#DDEBF0":"#FFE8AD");
  const rose=(cx,cy,R=19,metal="silver")=>{
    const grad=metal==="silver"?"silverPetal":"goldPetal",outline=metal==="silver"?"#434B56":"#75451A";
    let out=ellipse(cx,cy,R*.8,R*.8,"none",outline,1);
    for(let i=0;i<6;i++){const deg=i*60,rad=deg*Math.PI/180,dx=Math.cos(rad)*R*.62,dy=Math.sin(rad)*R*.62;
      out+=ellipse(cx+dx,cy+dy,R*.39,R*.65,`url(#${grad})`,outline,1.2,`rotate(${(deg+90).toFixed(1)} ${(cx+dx).toFixed(2)} ${(cy+dy).toFixed(2)})`);
    }
    return out+ellipse(cx,cy,R*.32,R*.32,`url(#${metal==="silver"?"silverJewel":"goldJewel"})`,outline,1.4)+ellipse(cx-R*.1,cy-R*.12,R*.08,R*.08,"#FFFFFF");
  };
  const leaf=(cx,cy,rot,size=14,metal="silver")=>{
    const grad=metal==="silver"?"silverPetal":"goldPetal",edge=metal==="silver"?"#535D66":"#8F641F";
    return `<g transform="translate(${cx} ${cy}) rotate(${rot})"><path d="M 0 0 Q ${(size*.63).toFixed(1)} ${(-size*.73).toFixed(1)} ${(size*1.6).toFixed(1)} ${(-size*.1).toFixed(1)} Q ${(size*.9).toFixed(1)} ${(size*.91).toFixed(1)} 0 0 Z" fill="url(#${grad})" stroke="${edge}" stroke-width="1"/>${path(`M 0 0 L ${(size*1.48).toFixed(1)} ${(-size*.1).toFixed(1)}`,edge,.9,"none",.48)}</g>`;
  };
  const sprig=(cx,cy,direction="right",metal="silver",angle=0)=>{
    const edge=metal==="silver"?"#7C8790":"#A77B2B",mul=direction==="right"?1:-1;
    let out=path(`M ${cx} ${cy} Q ${cx+mul*27} ${cy-10} ${cx+mul*72} ${cy-2}`,edge,2.2);
    for(let j=0;j<3;j++){const x=cx+mul*(18+j*20);out+=leaf(x,cy-7+(j%2)*3,mul===1?-55:-125,10-j*.4,metal);
      out+=leaf(x,cy+3+(j%2)*3,mul===1?35:145,9-j*.3,metal)}
    return `<g transform="rotate(${angle} ${cx} ${cy})">${out}</g>`;
  };
  const diamond=(cx,cy,R,metal="silver")=>{
    const grad=metal==="silver"?"silver":"gold",edge=metal==="silver"?"#F9FFFF":"#FFF3B5";
    return `<polygon points="${cx},${cy-R} ${cx+R*.77},${cy} ${cx},${cy+R} ${cx-R*.77},${cy}" fill="url(#${grad})" stroke="${edge}" stroke-width="1"/>`+
      ellipse(cx,cy,3.8,3.8,`url(#${metal==="silver"?"silverJewel":"goldJewel"})`);
  };
  const shield=(cx,cy,scale=1)=>`<g transform="translate(${cx} ${cy}) scale(${scale})">
    <path d="M -18 -17 L 18 -17 L 17 5 Q 10 24 0 29 Q -11 23 -17 5 Z" fill="url(#charcoal)" stroke="#CFD5CF" stroke-width="2.8"/>
    <path d="M -11 -11 L 11 -11 L 10 6 Q 6 15 0 19 Q -6 15 -10 6 Z" fill="#162027" stroke="#B3BDC4" stroke-width="1.3"/>
    <path d="M 0 -8 L 0 14 M -9 0 Q -8 -7 -3 -4 L 0 4 L 3 -4 Q 8 -7 9 0 Q 5 1 3 7 L -3 7 Q -5 1 -9 0 Z" fill="#E3E5DE" stroke="#F2F5EC" stroke-width="1.4"/>
    <path d="M -7 8 L 7 8" stroke="#E3E5DE" stroke-width="2"/></g>`;
  const sword=(cx,cy,angle=0)=>`<g transform="translate(${cx} ${cy}) rotate(${angle})">
    <path d="M 0 -18 L 4 -7 L 3 12 L 0 21 L -3 12 L -4 -7 Z" fill="#A8B5BC" stroke="#11171A" stroke-width="1.8"/>
    <path d="M -11 4 L 11 4" stroke="#D4D8D7" stroke-width="4" stroke-linecap="round"/>
    <path d="M -2 10 L -2 17" stroke="#222D34" stroke-width="2"/>
    <circle cx="0" cy="19" r="2.5" fill="#D7DDDA"/></g>`;
  const crenel=(cx,top=true)=>{
    const y=top?4:771;
    let v="";
    for(const xOff of [-23,-7,9])v+=`<rect x="${cx+xOff}" y="${y}" width="16" height="19" fill="url(#charcoal)" stroke="#B2BABD" stroke-width="1.3"/>`;
    return v+`<rect x="${cx-26}" y="${y+13}" width="56" height="22" rx="2" fill="url(#charcoal)" stroke="#B2BABD" stroke-width="1.5"/>`;
  };
  let v="";
  if(frame==="doubleLine"){
    // The gap between rails is intentional; the older thin double-line lacked contrast.
    v+=rect(11,11,1178,778,42,"#1D2930",9)+rect(11,11,1178,778,42,"#F9FCFA",5)+rect(11,11,1178,778,42,"#7D9594",1);
    v+=rect(34,34,1132,732,27,"#1D3537",8)+rect(34,34,1132,732,27,"#BFCED0",4)+rect(34,34,1132,732,27,"#FFFFFF",1);
    for(const [x,y] of [[600,11],[600,789],[11,400],[1189,400]])v+=diamond(x,y,8);
  }else if(frame==="softRounded"){
    v+=rect(15,15,1170,770,62,"#947C72",35)+rect(15,15,1170,770,62,"url(#creamCushion)",28);
    v+=rect(13,13,1174,774,64,"#FFFCF6",4,.92)+rect(27,27,1146,746,48,"#C7AA9B",4,.8)+rect(32,32,1136,736,44,"#FFF9EE",3,.97);
    for(const [x,y] of [[63,28],[1137,28],[63,772],[1137,772]])v+=ellipse(x,y,6,6,"url(#creamCushion)","#C0A596",1.4)+ellipse(x-2,y-2,1.5,1.5,"#FFFDF8");
    for(const [x,y] of [[24,400],[1176,400],[600,24],[600,776]])v+=ellipse(x,y,9,9,"url(#creamCushion)","#AD958A",1.7)+ellipse(x-2,y-2,2,2,"#FFF8EC");
  }else if(frame==="silverFloral"){
    v+=rect(17,17,1166,766,43,"#252D33",31)+rect(17,17,1166,766,43,"url(#silver)",25);
    v+=rect(11,11,1178,778,49,"#F7FFFF",3,.9)+rect(18,18,1164,764,40,"#36414A",3);
    v+=rect(31,31,1138,738,30,"#F7FFFF",4,.96)+rect(36,36,1128,728,27,"#697987",2);
    for(const [x,y,direction,angle] of [[35,36,"right",0],[1164,36,"left",0],[36,764,"right",-12],[1164,765,"left",14]]){
      v+=sprig(x,y,direction,"silver",angle)+rose(x,y,29,"silver")+rose(x+(direction==="right"?63:-63),y,13,"silver");
    }
    for(const [x,y] of [[600,19],[600,781],[18,401],[1182,401]])v+=diamond(x,y,11);
    for(const [x,y] of [[80,17],[1120,17],[80,783],[1120,783],[17,115],[1183,686]])v+=gleam(x,y,12,"#F9FFFF");
    for(const [x,y] of [[112,24],[1085,24],[112,776],[1085,776]])v+=medal(x,y,"silver");
  }else if(frame==="goldCelestial"){
    v+=rect(17,17,1166,766,42,"#553716",31)+rect(17,17,1166,766,42,"url(#gold)",26);
    v+=rect(13,13,1174,774,46,"#FFE5A4",3,.94)+rect(22,22,1156,756,38,"#714417",3);
    v+=rect(32,32,1136,736,28,"#FFEC9B",4)+rect(37,37,1126,726,24,"#BB802A",2);
    for(const [x,y,R] of [[43,43,29],[1158,755,30],[43,756,22],[1158,43,25],[600,16,18],[600,784,18]])v+=star(x,y,R,3.5,8,"url(#goldPetal)","#FFF3BE",1.5);
    for(const [x,y] of [[133,20],[224,20],[978,20],[1080,20],[90,781],[241,781],[961,781],[1084,781],[17,238],[1183,541]])v+=star(x,y,6,1.3,4,"url(#gold)","#FFF2B3",1);
    v+='<path d="M 1137 27 A 20 20 0 1 0 1165 57 A 17 17 0 0 1 1137 27 Z" fill="url(#goldPetal)" stroke="#704219" stroke-width="1.8"/>';
    v+=gleam(1173,56,17,"#FFF4C2")+path("M 1125 17 Q 1066 21 1015 17 M 1049 26 Q 1023 20 990 29","#FFF0AF",2.2);
    v+=path("M 75 781 Q 113 759 153 780 M 973 781 Q 1008 765 1060 782","#FFE7A1",2.4);
    for(const [x,y] of [[262,22],[294,24],[325,21],[925,21],[898,22],[864,23],[95,778],[119,774],[151,775]])v+=ellipse(x,y,2.4,2.4,"url(#goldJewel)");
    for(const [x,y] of [[17,401],[1183,401]])v+=diamond(x,y,14,"gold");
  }else if(frame==="blackKnight"){
    v+=rect(17,17,1166,766,38,"#0A0F12",34)+rect(17,17,1166,766,38,"url(#charcoal)",29);
    v+=rect(13,13,1174,774,43,"#9FAAAC",3,.8)+rect(24,24,1152,752,34,"#12191E",3);
    v+=rect(35,35,1130,730,27,"#9CA8AB",3)+rect(40,40,1120,720,25,"#212E34",2);
    for(const [y,offset] of [[13,0],[29,39],[771,0],[787,39]]){
      for(let x=-40+offset;x<1200;x+=86){const xx=Math.max(0,x);v+=path(`M ${xx} ${y} l 0 ${y<400?9:-9}`,"#889194",1.7,"none",.78);
        if(y===13||y===771)v+=path(`M ${xx+7} ${y+3} l 42 0`,"#768084",1.15,"none",.5)}
    }
    for(const [x,offset] of [[13,0],[29,29],[1171,0],[1187,29]]){
      for(let y=70+offset;y<760;y+=64)v+=path(`M ${x} ${y} l ${x<400?11:-11} 0`,"#889399",1.7,"none",.75);
    }
    for(let x=78;x<1130;x+=98)v+=path(`M ${x} 1 l 0 35 M ${x+49} 768 l 0 31`,"#CBD2D3",2.2,"none",.85);
    for(let y=90;y<740;y+=87)v+=path(`M 1 ${y} l 37 0 M 1162 ${y+37} l 37 0`,"#BBC7CC",2.1,"none",.78);
    for(const x of [37,1163]){
      v+=crenel(x,true)+crenel(x,false);
      v+=path(`M ${x} 33 l 0 23 M ${x} 745 l 0 22`,"#E0E7E4",3.1,"none",.9);
    }
    for(const [x,y] of [[17,165],[1183,635],[17,635],[1183,165]])v+=ellipse(x,y,8,8,"url(#silverJewel)","#12171A",2)+ellipse(x-1.5,y-1.5,2,2,"#FAFDFF");
    for(const [x,y] of [[215,19],[985,19],[215,781],[985,781]])v+=diamond(x,y,9);
    v+=shield(600,24,1.03)+shield(600,766,.88)+shield(1171,400,1.15)+shield(29,400,1.1);
    v+=sword(26,301,-8)+sword(1174,500,8);
    for(const [x,y,angle] of [[77,21,0],[1120,21,180],[77,780,0],[1120,780,180]]){
      v+=`<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M -13 0 l 13 -7 l 13 7 l -13 7 Z" fill="#303D45" stroke="#C2CACB" stroke-width="1.5"/></g>`;
    }
  }else{
    return null;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${v}</svg>`;
}
