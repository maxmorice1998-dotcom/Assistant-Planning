'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {calendarFromSnapshot}=require('../colleague-runner');
test('reuses the post-sync read and keeps exactly 28 days with full titles',()=>{
 const title='Formation avec tous les details\nLieu et participants';
 const result=calendarFromSnapshot({calendarAfter:{from:'2026-12-20',events:[
  {id:'a',dates:['2026-12-19','2026-12-20','2027-01-16','2027-01-17'],text:title,startTime:'09:00',endTime:'17:00',indispo:false},
  {id:'outside',dates:['2027-01-17'],text:'Outside'},
 ]}},new Date(2026,11,20));
 assert.equal(result.from,'2026-12-20');assert.equal(result.to,'2027-01-16');
 assert.equal(result.events.length,1);assert.deepEqual(result.events[0].dates,['2026-12-20','2027-01-16']);assert.equal(result.events[0].text,title);
});
test('empty current read is valid; missing or previous-day read uses fallback',()=>{
 const today=new Date(2026,8,18);
 assert.equal(calendarFromSnapshot(null,today),null);
 assert.equal(calendarFromSnapshot({calendarAfter:{from:'2026-09-17',events:[]}},today),null);
 assert.equal(calendarFromSnapshot({calendarAfter:{from:'2026-09-18'}},today),null);
 assert.deepEqual(calendarFromSnapshot({calendarAfter:{from:'2026-09-18',events:[]}},today).events,[]);
});
test('sync response carries the calendar directly to the UI',async()=>{
 const runner=require('../colleague-runner'),diagnostic=require('../diagnostic-report');
 const originalRun=runner.run,originalFlush=diagnostic.flushPending;
 const calendar={ok:true,from:'2026-09-18',to:'2026-10-15',events:[]};
 runner.run=async()=>({ok:true,results:[],calendar,summary:{},durationMs:123});diagnostic.flushPending=()=>{};
 try {const response=await require('../ui-backend').handle({action:'synchronize'});assert.equal(response.calendar,calendar);}
 finally {runner.run=originalRun;diagnostic.flushPending=originalFlush;}
});
