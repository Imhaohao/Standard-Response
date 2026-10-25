export type DisasterKind = "fire" | "hurricane" | "flood";
// Which side of the mark its label sits on, so neighbours on the Gulf Coast don't collide.
export type LabelSide = "right" | "left" | "below";

// Recent US wildfires, floods and hurricanes, each placed at the town or city it is known by.
export const DISASTERS: { name: string; year: number; kind: DisasterKind; lat: number; lng: number; label: LabelSide }[] = [
  { name: "Eaton Fire", year: 2025, kind: "fire", lat: 34.19, lng: -118.15, label: "right" },
  { name: "Camp Fire", year: 2018, kind: "fire", lat: 39.76, lng: -121.62, label: "right" },
  { name: "Maui fires", year: 2023, kind: "fire", lat: 20.88, lng: -156.68, label: "right" },
  { name: "Hill Country flood", year: 2025, kind: "flood", lat: 30.05, lng: -99.14, label: "left" },
  { name: "Hurricane Harvey", year: 2017, kind: "hurricane", lat: 29.76, lng: -95.37, label: "below" },
  { name: "Hurricane Katrina", year: 2005, kind: "hurricane", lat: 29.95, lng: -90.07, label: "right" },
  { name: "Hurricane Ian", year: 2022, kind: "hurricane", lat: 26.64, lng: -81.87, label: "right" },
  { name: "Hurricane Helene", year: 2024, kind: "hurricane", lat: 35.6, lng: -82.55, label: "right" },
  { name: "Hurricane Sandy", year: 2012, kind: "hurricane", lat: 40.71, lng: -74.0, label: "right" },
];
