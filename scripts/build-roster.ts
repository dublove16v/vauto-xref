import { writeFileSync } from "node:fs";
import XLSX from "xlsx";
import { joinBooks, parseWorkbook, pickBooks } from "../src/lib/xref/model.ts";

const masterPath =
  "/workspace/attachments/Master Inventory Report (Used)-A Better Way Wholesale Autos-2026-10-05-0804.xls";
const reportPath = "/workspace/attachments/REPORT (3).xlsx";

function load(path: string) {
  const wb = XLSX.readFile(path, { cellDates: true });
  const name = path.split("/").pop() ?? path;
  return parseWorkbook(XLSX, wb, name);
}

const books = pickBooks([load(masterPath), load(reportPath)]);
const cars = joinBooks(books);
const ready = cars.filter((car) => car.ready);
console.log(
  `vauto ${books.vauto.length} dms ${books.dms.length} ready ${ready.length} asOf ${books.vautoAsOf} / ${books.dmsAsOf}`,
);
if (ready.length !== 18) {
  console.log(ready.map((car) => car.stock).join(", "));
  throw new Error(`expected 19 highlighted cars, got ${ready.length}`);
}
writeFileSync("/workspace/src/data/roster.json", JSON.stringify(books));
console.log("wrote src/data/roster.json");
