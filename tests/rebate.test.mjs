import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePayload} from '../public/backup.js';
const id='11111111-1111-4111-8111-111111111111';
function payload(gross,redeemed,earned){return {format:'line-member-business',version:3,created_at:'2026-09-12T00:00:00Z',admins:[],members:[{id}],transactions:[{id,member_id:id,gross,redeemed,paid:gross-redeemed,earned}],audit:[],points:earned-redeemed};}
test('5% whole-hundred rewards and redemption boundaries validate',()=>{
 for(const [gross,redeemed,earned] of [[99,0,0],[100,0,5],[199,0,5],[200,0,10],[500,0,25],[1000,0,50],[500,100,20],[500,50,20],[100,100,0]]){
  assert.equal(validatePayload(payload(gross,redeemed,earned)).points,earned-redeemed);
 }
});
test('backup refuses old 10% rewards and rewards on sub-hundred remainder',()=>{
 for(const [paid,earned] of [[100,10],[500,50],[1000,100],[199,9]])assert.throws(()=>validatePayload(payload(paid,0,earned)),/驗證失敗/);
});
