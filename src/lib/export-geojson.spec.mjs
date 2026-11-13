import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMemorial} from './memorial-parser.ts';
import {montarGeoJson} from './export-geojson.ts';
const parsed=parseMemorial(readFileSync(new URL('./fixtures/urban-utm-2918.txt',import.meta.url),'utf8'));
const parcel={...parsed,raw_extraction:{vertices:parsed.vertices}};
const ref={zone:23,hemisphere:'S',datum:'SIRGAS2000'};
test('GeoJSON contains the four real edges, WGS84 ring and original UTM',()=>{
 const data=JSON.parse(montarGeoJson([parcel],[ref]));
 assert.equal(data.type,'FeatureCollection');
 const f=data.features[0];
 assert.equal(f.geometry.type,'Polygon');
 const ring=f.geometry.coordinates[0];
 assert.equal(ring.length,5);assert.deepEqual(ring[0],ring[4]);
 assert.ok(ring.some(c=>Math.abs(c[0]+47.47791017124115)<1e-8 && Math.abs(c[1]+21.703607313080497)<1e-8));
 assert.deepEqual(f.properties.trechos.map(s=>s.distancia_m),[15,18.79,15,18.79]);
 assert.equal(f.properties.extracao_original.vertices[0].east,243641.483);
 assert.equal(f.properties.extracao_original.vertices[0].lat,null);
});
for(const field of ['zone','hemisphere','datum']) test(`JSON refuses unconfirmed ${field}`,()=>{
 const r={...ref};delete r[field];assert.throws(()=>montarGeoJson([parcel],[r]),/inválida/);
});
test('JSON refuses missing coordinates and open walks',()=>{
 const p=structuredClone(parcel);p.raw_extraction.vertices[1].east=null;
 assert.throws(()=>montarGeoJson([p],[ref]),/ausentes/);
 assert.throws(()=>montarGeoJson([{...parcel,segments:parcel.segments.slice(0,3)}],[ref]),/fechado/);
});