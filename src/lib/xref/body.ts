export type BodyJob = {
  stock: string;
  shop: string;
  work: string;
};

export type BodyFeed = {
  pulledAt: string;
  source: string;
  jobs: BodyJob[];
};

export function stockKey(stock: string): string {
  return stock.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function shopLabel(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!name) return "Body";
  if (name.startsWith("ruiz")) return "Ruiz";
  if (name.startsWith("master")) return "Master";
  if (name.startsWith("robb")) return "Robb";
  return raw.trim();
}

export function stockFromBodyVehicle(vehicle: string): string | null {
  const last = vehicle.trim().split(/\s+/).at(-1) ?? "";
  if (!/\d/.test(last)) return null;
  const key = stockKey(last);
  if (!/[a-z]/i.test(key) && key.length < 5) return null;
  return key || null;
}

export function bodyIndex(jobs: BodyJob[]): Map<string, BodyJob> {
  const map = new Map<string, BodyJob>();
  for (const job of jobs) {
    const stock = stockKey(job.stock);
    if (!stock) continue;
    const prev = map.get(stock);
    map.set(stock, {
      stock,
      shop: shopLabel(job.shop),
      work: prev?.work && prev.work !== job.work ? `${prev.work}; ${job.work}` : job.work,
    });
  }
  return map;
}
