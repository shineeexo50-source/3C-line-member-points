import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const admin=fs.readFileSync(new URL('../public/admin.js', import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/style.css', import.meta.url),'utf8');
test('v3.9.2 admin menu maps requested functions and excludes product inventory management',()=>{
 for(const label of ['首頁','會員管理','新增會員','會員列表','新增消費','客訂商品','消費紀錄','統計報表','店員管理','系統設定']) assert.match(admin,new RegExp(`'${label}'`));
 assert.doesNotMatch(admin,/navButton\([^\n]*商品管理/);
 assert.doesNotMatch(admin,/navButton\([^\n]*庫存管理/);
 assert.doesNotMatch(admin,/catalogView|admin_catalog/);
});
test('admin style has explicit non glass modern override',()=>{
 assert.match(css,/v3\.9\.2 · 管理端現代化版/);
 assert.match(css,/backdrop-filter:none/);
 assert.match(css,/admin-desktop-header/);
});
