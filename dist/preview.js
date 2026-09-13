import {root,status} from './core.js?v=05031f791b31';
import {customerView} from './customer-ui.js?v=05031f791b31';
// Explicit public demonstration. Never calls the member API or the LINE SDK.
const demoData={member:{id:'00000000-0000-4000-8000-000000000001',display_name:'小葵'},points:360,total:4600,visits:8,point_days:[{day:'2026-09-10',earned:100},{day:'2026-09-08',earned:60},{day:'2026-09-05',earned:200}],next_day:null};
document.querySelector('#brand').textContent='3C手機配件';
root.replaceChildren(customerView(demoData,{demo:true,updatedAt:new Date('2026-09-10T12:30:00+08:00'),refresh:()=>status('這是示範會員卡，沒有讀取或修改真實資料。')}));
status('設計預覽 · 全部數字均為示範資料');
