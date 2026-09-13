import test from 'node:test';import assert from 'node:assert/strict';import {parseCSV,parseImport,csvText,importHeaders} from '../public/csv.js';
const member='11111111-1111-4111-8111-111111111111';
const file=rows=>csvText(importHeaders,rows);
test('CSV quotes, Chinese BOM, commas and multiline notes survive',()=>{assert.deepEqual(parseCSV('\ufeff"姓名","備註"\r\n"璃璃","甲,乙\n他說""好"""'),[['姓名','備註'],['璃璃','甲,乙\n他說"好"']]);});
test('multi-item order groups once and interprets local time as Taipei',()=>{const d=parseImport(file([['SHOP-001',member,'2026-09-01 10:00','手機殼',1,300,10,'備註'],['SHOP-001',member,'2026-09-01 10:00','充電線',2,100,'','']]));assert.equal(d.length,1);assert.equal(d[0].gross,500);assert.equal(d[0].redeemed,10);assert.equal(d[0].occurred_at,'2026-09-01T02:00:00.000Z');assert.equal(d[0].items.length,2);});
test('inconsistent customer on same order rejected',()=>{assert.throws(()=>parseImport(file([['A',member,'2026-09-01 10:00','殼',1,300,0,''],['A','22222222-2222-4222-8222-222222222222','2026-09-01 10:00','線',1,100,0,'']])),/不一致/);});
test('invalid date, fractional quantity and overspending fail before upload',()=>{for(const row of [['A',member,'2026-02-30 10:00','殼',1,300,0,''],['A',member,'2026-09-01 10:00','殼','1.2',300,0,''],['A',member,'2026-09-01 10:00','殼',1,300,400,'']])assert.throws(()=>parseImport(file([row])));});
test('CSV export escapes formulas but preserves numeric amounts',()=>{const parsed=parseCSV(csvText(['a','b','c'],[['=HYPERLINK("bad")',' +SUM(1,2)',-20]]));assert.ok(parsed[1][0].startsWith("'="));assert.ok(parsed[1][1].startsWith("' "));assert.equal(parsed[1][2],'-20');});
test('unclosed quote and unknown header fail clearly',()=>{assert.throws(()=>parseCSV('"incomplete'),/引號/);assert.throws(()=>parseImport('a,b\n1,2'),/範本/);});
