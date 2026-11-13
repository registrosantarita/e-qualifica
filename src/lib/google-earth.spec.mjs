import { test } from "node:test";
import assert from "node:assert/strict";
import { earthKml } from "./google-earth.ts";
import { confirmedEarthUtm } from "./earth-utm.ts";
import { readFileSync } from "node:fs";
import { parseMemorial } from "./memorial-parser.ts";
const point = (lon, lat) => ({label:"Local",segments:[],raw_extraction:{vertices:[{name:"P1",lon,lat,alt:null,east:null,north:null}]}});
test("a single coordinate pair exports as a point, never an invented polygon", () => {
 const r=earthKml([point(-47.123456,-21.654321)]);
 assert.ok(r.text.includes('<Point><coordinates>-47.123456,-21.654321</coordinates></Point>'));
 assert.equal(r.text.includes('<Polygon>'),false);
});
test("missing or out-of-range coordinates do not open Earth", () => {
 assert.throws(()=>earthKml([point(null,-21)]),/válidas/);
 assert.throws(()=>earthKml([point(-190,-21)]),/válidas/);
});
const utmPoint = (east, north) => ({label:"UTM",segments:[],raw_extraction:{vertices:[{name:"1",lon:null,lat:null,alt:null,east,north}]}});
for (const field of ["zone", "hemisphere", "datum"]) {
 test(`export is blocked when ${field} has not been confirmed`, () => {
  const reference = {zone:23,hemisphere:"S",datum:"SIRGAS2000"};
  delete reference[field];
  assert.equal(confirmedEarthUtm(reference),false);
  assert.throws(()=>earthKml([utmPoint(243641.483,7597928.085)],[reference]),/inválida/);
 });
}
test("the four original matrícula 2.918 vertices retain their order in Earth", () => {
 const parsed = parseMemorial(readFileSync(new URL("./fixtures/urban-utm-2918.txt",import.meta.url),"utf8"));
 const p = {...parsed,raw_extraction:{vertices:parsed.vertices}};
 assert.equal(p.segments.length,4);
 assert.deepEqual(p.segments.map(s=>[s.from_vertex,s.to_vertex]),[["1","2"],["2","3"],["3","4"],["4","1"]]);
 assert.deepEqual(p.segments.map(s=>s.distance_m),[15,18.79,15,18.79]);
 const r = earthKml([p],[{zone:23,hemisphere:"S",datum:"SIRGAS2000"}]);
 const coords = r.text.match(/<coordinates>(.*?)<\/coordinates>/)[1].split(" ").map(c=>c.split(",").map(Number));
 assert.equal(coords.length,5);
 assert.deepEqual(coords[0],coords[4]);
 // Independent PROJ inverse values for EPSG:31983 -> EPSG:4326.
 const expected = [[-47.47791017124115,-21.703607313080497],[-47.47776713796826,-21.703585635288245],[-47.4777303065254,-21.703751723949583],[-47.477873339963274,-21.70377340175821]];
 coords.slice(0,4).forEach((c,i)=>c.forEach((v,axis)=>assert.ok(Math.abs(v-expected[i][axis])<1e-7)));
 assert.ok(p.vertices.every(v=>v.lon===null && v.lat===null && v.alt===null));
});
test("UTM converts to an Earth point with confirmed zone and hemisphere", () => {
 const p = utmPoint(500000,10000000);
 const r = earthKml([p],[{zone:23,hemisphere:"S",datum:"SIRGAS2000"}]);
 assert.ok(Math.abs(r.lon + 45) < 1e-9);
 assert.ok(Math.abs(r.lat) < 1e-9);
 assert.ok(r.text.includes("<Point>"));
 assert.equal(p.raw_extraction.vertices[0].lon,null);
 assert.equal(p.raw_extraction.vertices[0].east,500000);
});
test("UTM reference is required, never inferred from the user's location", () => {
 assert.throws(()=>earthKml([utmPoint(500000,7610000)]),/fuso, hemisfério e datum/);
});
test("each comparison parcel requires its own reference", () => {
 assert.throws(()=>earthKml([utmPoint(500000,7610000),utmPoint(500000,7610000)],[{zone:23,hemisphere:"S",datum:"WGS84"}]),/fuso/);
});
test("missing coordinates cannot be replaced by UTM conversion", () => {
 assert.throws(()=>earthKml([utmPoint(null,7610000)],[{zone:23,hemisphere:"S",datum:"WGS84"}]),/válidas/);
});
test("invalid UTM reference and coordinates are rejected", () => {
 assert.throws(()=>earthKml([utmPoint(500000,7610000)],[{zone:0,hemisphere:"S",datum:"WGS84"}]),/inválida/);
 assert.throws(()=>earthKml([utmPoint(500000,10000001)],[{zone:23,hemisphere:"S",datum:"WGS84"}]),/limites/);
});
test("a closed UTM walk becomes a closed polygon and preserves absent altitude", () => {
 const p = utmPoint(500000,7600000);
 p.raw_extraction.vertices.push({name:"2",east:500015,north:7600000,lon:null,lat:null,alt:null},{name:"3",east:500015,north:7600018.79,lon:null,lat:null,alt:null},{name:"4",east:500000,north:7600018.79,lon:null,lat:null,alt:null});
 p.segments = [1,2,3,4].map((n,i)=>({seq:n,from_vertex:String(n),to_vertex:String(i===3?1:n+1)}));
 const r = earthKml([p],[{zone:23,hemisphere:"S",datum:"WGS84"}]);
 assert.ok(r.text.includes("<Polygon>"));
 const coords = r.text.match(/<coordinates>(.*?)<\/coordinates>/)[1].split(" ");
 assert.equal(coords.length,5);
 assert.equal(coords[0],coords[4]);
 assert.ok(coords.every(c=>c.split(",").length===2));
 assert.ok(Math.abs(r.lon + 45)<1e-9);
 assert.ok(r.lat < -21 && r.lat > -22);
 assert.equal(p.raw_extraction.vertices[3].lat,null);
});