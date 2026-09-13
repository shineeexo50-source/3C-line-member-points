import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const admin=fs.readFileSync(new URL('../public/admin.js', import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/style.css', import.meta.url),'utf8');
test('v3.9.2 stable rebuild exposes only requested primary menu',()=>{
 for(const label of ['會員列表','新增會員','客訂商品','統計報表','店員管理','系統設定']) assert.match(admin,new RegExp(`navButton\\([^\\n]*'${label}'`));
 for(const label of ['首頁','會員管理','新增消費','消費紀錄','商品管理','庫存管理']) assert.doesNotMatch(admin,new RegExp(`navButton\\([^\\n]*'${label}'`));
 assert.doesNotMatch(admin,/catalogView|admin_catalog/);
});
test('admin style is clean dashboard and explicitly disables glass effects',()=>{
 assert.match(css,/v3\.9\.2 stable rebuild/);
 assert.match(css,/backdrop-filter:none/);
 assert.match(css,/admin-desktop-header/);
 assert.match(css,/member-showcase-head/);
});
