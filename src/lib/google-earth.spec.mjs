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