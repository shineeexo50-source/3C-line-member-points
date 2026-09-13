import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePayload} from '../public/backup.js';
const id='11111111-1111-4111-8111-111111111111';
function payload(gross,redeemed,earned,rate=10){return {format:'line-member-business',version:3,created_at:'2026-09-12T00:00:00Z',admins:[],members:[{id}],transactions:[{id,member_id:id,gross,redeemed,paid:gross-redeemed,earned,...(rate===undefined?{}:{reward_per_100:rate})}],audit:[],points:earned-redeemed};}
test('10% whole-hundred rewards and redemption boundaries validate',()=>{
 for(const [gross,redeemed,earned] of [[99,0,0],[100,0,10],[150,0,10],[199,0,10],[200,0,20],[500,0,50],[1000,0,100],[500,100,40],[500,50,40],[100,100,0]])assert.equal(validatePayload(payload(gross,redeemed,earned)).points,earned-redeemed);
});
test('backup preserves old 5% rewards and rejects mismatched rate or remainder',()=>{
 assert.equal(validatePayload(payload(500,0,25,5)).points,25);
 const old=payload(500,0,25);delete old.transactions[0].reward_per_100;assert.equal(validatePayload(old).points,25);
 for(const [paid,earned,rate] of [[100,5,10],[500,50,5],[199,19,10],[100,10,7]])assert.throws(()=>validatePayload(payload(paid,0,earned,rate)),/驗證失敗/);
});
