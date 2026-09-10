import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../../conformance/comparison/',import.meta.url);
const read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const manifest=read('manifest.json');assert.equal(manifest.exactValues,'exact-values.json');
const pack=read(manifest.exactValues);
assert.equal(pack.scope,'comparison-profile');assert.equal(pack.profile,manifest.profile);
const ids=new Set();let texts=0,roundingControls=0;
// A token guard for these fixtures, not a parser, comparator or numeric engine.
// JSON.parse checks syntax only; its possibly rounded result is discarded.
function tokens(raw){
 JSON.parse(raw);
 return [...raw.matchAll(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g)]
  .map(m=>m[0]).filter(t=>!t.startsWith('"')).sort();
}
for(const c of pack.cases){
 assert(!ids.has(c.id),'duplicate case '+c.id);ids.add(c.id);
 for(const side of ['left','right',...(c.witness?['witness']:[])]){
  const raw=side==='witness'?c.witness.instanceJSON:c[side+'JSON'];
  assert.deepEqual(tokens(raw),c.numberTokens[side],c.id+' '+side+' token witnesses');texts++;
  // Negative control: show a native parse/reserialize route would not pass
  // the ingress guard. Never use this altered text as a test input.
  if(JSON.stringify(tokens(JSON.stringify(JSON.parse(raw))))!==JSON.stringify(c.numberTokens[side]))roundingControls++;
 }
 assert(c.expected.error==='schema'||['compatible','incompatible','indeterminate'].includes(c.expected.verdict));
 if(c.witness&&c.expected.verdict==='incompatible'){
  assert(c.direction==='input'?c.witness.targetValid&&!c.witness.candidateValid:!c.witness.targetValid&&c.witness.candidateValid,c.id+' witness contradicts claimed incompatibility');
 }
}
assert(roundingControls>0,'native-rounding negative controls missing');
console.log(JSON.stringify({scope:'comparison-profile fixture integrity, not Core conformance',cases:ids.size,texts,nativeRoundtripTokenChangesDetected:roundingControls}));
