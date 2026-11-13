import { test } from "node:test";
import assert from "node:assert/strict";
import { earthKml } from "./google-earth.ts";
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