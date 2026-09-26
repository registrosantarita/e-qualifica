import { describe, expect, it } from "bun:test";
import { parseMemorial } from "./memorial-parser";

describe("caminhamento até atingir o ponto", () => {
  const exemplo = `A poligonal inicia no ponto 1, de coordenadas Latitude:-21°34'22,47460"S e Longitude:-47°30'11,01434"W, referidas ao Sistema Geocêntrico SIRGAS 2000, situado no Km 47+234,84m da LT; deste segue com azimute de 46º06'35'' e distância de 5,36m, confrontando com terras de SYLVAMO DO BRASIL LTDA até atingir o ponto 2, de coordenadas Latitude:-21°34'22,35574"S e Longitude:-47°30'10,87782"W;`;

  it("atribui chegada, grandezas, confrontante e coordenadas ao mesmo trecho", () => {
    const parcel = parseMemorial(exemplo);
    expect(parcel.segments).toHaveLength(1);
    expect(parcel.segments[0]).toMatchObject({
      from_vertex: "1", to_vertex: "2", distance_m: 5.36,
      confrontante: "terras de SYLVAMO DO BRASIL LTDA",
    });
    expect(parcel.segments[0]?.azimuth_deg).toBeCloseTo(46 + 6 / 60 + 35 / 3600, 6);
    expect(parcel.vertices.find((v) => v.name === "1")?.lat).toBeCloseTo(-21.57290961, 7);
    expect(parcel.vertices.find((v) => v.name === "2")?.lon).toBeCloseTo(-47.50302162, 7);
  });

  it("encadeia as chegadas sem gerar trecho vazio", () => {
    const parcel = parseMemorial(`${exemplo} Deste segue com azimute de 90º00'00'' e distância de 8,00m, confrontando com terras de MARIA até atingir o ponto 3, de coordenadas Latitude:-21°34'22,35574"S e Longitude:-47°30'10,60000"W;`);
    expect(parcel.segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m])).toEqual([
      ["1", "2", 5.36], ["2", "3", 8],
    ]);
    expect(parcel.segments[1]?.confrontante).toBe("terras de MARIA");
  });
});