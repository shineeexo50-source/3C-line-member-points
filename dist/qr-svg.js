import QRCode from './qr-lib-index.js?v=d0b5d1b3e54d';
import QRErrorCorrectLevel from './qr-lib-QRErrorCorrectLevel.js?v=d0b5d1b3e54d';

export function makeQrSvg(text,{size=240,margin=4}={}){
  const qr=new QRCode(-1,QRErrorCorrectLevel.M);
  qr.addData(String(text));
  qr.make();
  const count=qr.getModuleCount(),total=count+margin*2,scale=size/total;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`0 0 ${size} ${size}`);svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));
  svg.setAttribute('role','img');svg.setAttribute('aria-label','會員 QR Code');svg.classList.add('member-qr-svg');
  const bg=document.createElementNS(ns,'rect');bg.setAttribute('width',String(size));bg.setAttribute('height',String(size));bg.setAttribute('fill','#fff');svg.append(bg);
  const path=document.createElementNS(ns,'path');let d='';
  for(let r=0;r<count;r++)for(let c=0;c<count;c++)if(qr.isDark(r,c)){
    const x=(c+margin)*scale,y=(r+margin)*scale;
    d+=`M${x} ${y}h${scale}v${scale}h-${scale}z`;
  }
  path.setAttribute('d',d);path.setAttribute('fill','#0b1720');svg.append(path);return svg;
}
