import {el,table,money} from './core.js';
const ns='http://www.w3.org/2000/svg';
function svgEl(tag,attrs={},text){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;return e;}
export function lineChart(days,key,label){
 const wrap=el('div'),svg=svgEl('svg',{viewBox:'0 0 760 280',role:'img','aria-label':label+'每日趨勢','class':'line-chart'});svg.append(svgEl('title',{},label+'每日趨勢，詳細數值見下方表格'));
 const max=Math.max(1,...days.map(d=>Number(d[key]))),left=76,right=735,top=22,bottom=224;
 for(let i=0;i<=4;i++){const y=bottom-(bottom-top)*i/4;svg.append(svgEl('line',{x1:left,y1:y,x2:right,y2:y,stroke:'#dce5ef'}),svgEl('text',{x:left-8,y:y+5,'text-anchor':'end',fill:'#53667b','font-size':14},Number((max*i/4).toFixed(1)).toLocaleString()));}
 const points=days.map((d,i)=>[left+(right-left)*i/Math.max(1,days.length-1),bottom-(bottom-top)*Number(d[key])/max]);
 if(points.length){svg.append(svgEl('path',{d:'M '+points.map(p=>p.join(' ')).join(' L '),fill:'none',stroke:'#7052d6','stroke-width':3,'stroke-linejoin':'round'}));
 points.forEach(([x,y],i)=>{const dot=svgEl('circle',{cx:x,cy:y,r:4,fill:'#7052d6'});dot.append(svgEl('title',{},`${days[i].day}：${days[i][key]}`));svg.append(dot);if(i===0||i===days.length-1||(i+1)%5===0)svg.append(svgEl('text',{x,y:253,'text-anchor':'middle',fill:'#53667b','font-size':14},String(i+1)+'日'));});}
 wrap.append(svg);const details=el('details');details.append(el('summary','查看每日數字'));details.append(table(['日期',label],days.map(d=>[d.day,key==='visits'?d[key]+' 次':money(d[key])])));wrap.append(details);return wrap;
}
export function donutChart(groups){
 const wrap=el('div',undefined,'donut-wrap'),total=groups.reduce((a,g)=>a+Number(g.value),0),svg=svgEl('svg',{viewBox:'0 0 240 240',role:'img','aria-label':'本月客戶消費頻率人數分布','class':'donut'}),colors=['#7658d4','#f38fa4','#47a7b7'];
 svg.append(svgEl('circle',{cx:120,cy:120,r:84,fill:'none',stroke:'#e9edf5','stroke-width':30}));let offset=0;const circumference=2*Math.PI*84;
 groups.forEach((g,i)=>{if(total&&g.value){const length=Number(g.value)/total*circumference;const arc=svgEl('circle',{cx:120,cy:120,r:84,fill:'none',stroke:colors[i%colors.length],'stroke-width':30,'stroke-dasharray':`${length} ${circumference-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 120 120)'});arc.append(svgEl('title',{},`${g.label}：${g.value} 人`));svg.append(arc);offset+=length;}});
 svg.append(svgEl('text',{x:120,y:118,'text-anchor':'middle','font-size':32,'font-weight':750,fill:'#223549'},total),svgEl('text',{x:120,y:147,'text-anchor':'middle','font-size':16,fill:'#596d80'},'消費會員'));
 const legend=el('div');groups.forEach((g,i)=>{const row=el('p',undefined,'legend-row'),swatch=el('span',undefined,'swatch swatch-'+i);row.append(swatch,el('span',g.label),el('strong',`${g.value} 人 · ${total?(g.value/total*100).toFixed(1):0}%`));legend.append(row);});wrap.append(svg,legend);return wrap;
}
