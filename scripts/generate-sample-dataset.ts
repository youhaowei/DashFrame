import { mkdir } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve(
  import.meta.dir,
  "../apps/server/sample-data",
);
const channels = [
  { name: "Organic Search", daily: 3, augustDaily: 3, base: 92.5 },
  { name: "Paid Search", daily: 3, augustDaily: 1, base: 108 },
  { name: "Direct", daily: 2, augustDaily: 2, base: 84 },
  { name: "Referral", daily: 1, augustDaily: 1, base: 99 },
  { name: "Email", daily: 1, augustDaily: 1, base: 116 },
  { name: "Organic Social", daily: 2, augustDaily: 0, base: 76 },
] as const;
const regions = ["West", "Northeast", "South", "Midwest"] as const;
const segments = ["Consumer", "Small Business", "Enterprise"] as const;
const customerCount = 320;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function customerId(index: number): string {
  return `C${String((index % customerCount) + 1).padStart(4, "0")}`;
}

function generateCustomers(): string {
  const rows = ["customer_id,signup_date,region,segment"];
  const start = Date.UTC(2023, 0, 1);
  for (let index = 0; index < customerCount; index += 1) {
    const signup = new Date(start + ((index * 11) % 700) * 86_400_000);
    rows.push(
      [
        customerId(index),
        isoDate(signup),
        regions[index % regions.length],
        segments[(index * 5) % segments.length],
      ].join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}

function generateOrders(): string {
  const rows = [
    "order_id,customer_id,order_date,channel,revenue,quantity,region",
  ];
  const firstDay = Date.UTC(2025, 5, 1);
  const lastDay = Date.UTC(2025, 8, 30);
  let orderIndex = 0;

  for (
    let timestamp = firstDay;
    timestamp <= lastDay;
    timestamp += 86_400_000
  ) {
    const date = new Date(timestamp);
    const august = date.getUTCMonth() === 7;
    for (
      let channelIndex = 0;
      channelIndex < channels.length;
      channelIndex += 1
    ) {
      const channel = channels[channelIndex]!;
      const count = august ? channel.augustDaily : channel.daily;
      for (let dailyIndex = 0; dailyIndex < count; dailyIndex += 1) {
        const customerIndex =
          (orderIndex * 17 + channelIndex * 13) % customerCount;
        const quantity = 1 + ((orderIndex + dailyIndex) % 3);
        const variation = 0.9 + ((orderIndex * 7) % 21) / 100;
        const revenue = (channel.base * quantity * variation).toFixed(2);
        rows.push(
          [
            `O${String(orderIndex + 1).padStart(5, "0")}`,
            customerId(customerIndex),
            isoDate(date),
            channel.name,
            revenue,
            quantity,
            regions[customerIndex % regions.length],
          ].join(","),
        );
        orderIndex += 1;
      }
    }
  }
  return `${rows.join("\n")}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  Bun.write(path.join(outputDirectory, "customers.csv"), generateCustomers()),
  Bun.write(path.join(outputDirectory, "orders.csv"), generateOrders()),
]);

console.log(`Generated sample data in ${outputDirectory}`);
