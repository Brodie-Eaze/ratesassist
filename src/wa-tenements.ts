// Mock WA mining tenement data. Schema mirrors DMIRS MINEDEX / GeoVIEW.WA fields.
// Real implementation will pull live from DMIRS WFS / public tenement API.

export type TenementType = "M" | "E" | "P" | "G" | "L";
// M = Mining Lease, E = Exploration Licence, P = Prospecting Licence,
// G = General Purpose Lease, L = Miscellaneous Licence

export type TenementStatus = "Live" | "Pending" | "Surrendered" | "Cancelled";

export type Tenement = {
  tenementId: string; // e.g. "M70/1234"
  type: TenementType;
  status: TenementStatus;
  holder: string;
  holderAbn: string | null;
  commodity: string[]; // e.g. ["Gold","Iron Ore"]
  grantedDate: string;
  expiryDate: string;
  areaHectares: number;
  // Polygon centroid — real version uses cadastral intersection
  intersectsAssessmentNumbers: string[];
  isProducing: boolean; // royalty-paying status from WA SRO
  lastWorkProgramYear: number | null;
};

export const TENEMENTS: Tenement[] = [
  {
    tenementId: "M70/1284",
    type: "M",
    status: "Live",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32 614 882 110",
    commodity: ["Iron Ore"],
    grantedDate: "2014-08-19",
    expiryDate: "2035-08-18",
    areaHectares: 4820,
    intersectsAssessmentNumbers: ["WA-1102-44"],
    isProducing: true,
    lastWorkProgramYear: 2025,
  },
  {
    tenementId: "M70/1411",
    type: "M",
    status: "Live",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32 614 882 110",
    commodity: ["Iron Ore", "Manganese"],
    grantedDate: "2017-03-04",
    expiryDate: "2038-03-03",
    areaHectares: 2260,
    intersectsAssessmentNumbers: ["WA-1102-47"],
    isProducing: true,
    lastWorkProgramYear: 2025,
  },
  {
    tenementId: "E45/5821",
    type: "E",
    status: "Live",
    holder: "Karratha Exploration Pty Ltd",
    holderAbn: "44 990 221 005",
    commodity: ["Lithium", "Rare Earths"],
    grantedDate: "2022-11-14",
    expiryDate: "2027-11-13",
    areaHectares: 18400,
    intersectsAssessmentNumbers: ["WA-1102-71"],
    isProducing: false,
    lastWorkProgramYear: 2024,
  },
  {
    tenementId: "M52/0908",
    type: "M",
    status: "Live",
    holder: "Goldfields Resources Ltd",
    holderAbn: "18 552 117 884",
    commodity: ["Gold"],
    grantedDate: "2009-06-22",
    expiryDate: "2030-06-21",
    areaHectares: 740,
    intersectsAssessmentNumbers: ["WA-2204-19"],
    isProducing: true,
    lastWorkProgramYear: 2025,
  },
  {
    tenementId: "P52/1701",
    type: "P",
    status: "Live",
    holder: "Sandstone Prospecting Pty Ltd",
    holderAbn: "82 144 029 561",
    commodity: ["Gold"],
    grantedDate: "2023-04-01",
    expiryDate: "2027-03-31",
    areaHectares: 90,
    intersectsAssessmentNumbers: ["WA-2204-31"],
    isProducing: false,
    lastWorkProgramYear: null,
  },
  {
    tenementId: "L70/0177",
    type: "L",
    status: "Live",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32 614 882 110",
    commodity: ["Infrastructure"],
    grantedDate: "2016-01-30",
    expiryDate: "2037-01-29",
    areaHectares: 320,
    intersectsAssessmentNumbers: ["WA-1102-91"],
    isProducing: false,
    lastWorkProgramYear: null,
  },
];

export function getTenementsForAssessment(assessmentNumber: string): Tenement[] {
  return TENEMENTS.filter((t) => t.intersectsAssessmentNumbers.includes(assessmentNumber));
}

export function getAllLiveTenements(): Tenement[] {
  return TENEMENTS.filter((t) => t.status === "Live");
}
