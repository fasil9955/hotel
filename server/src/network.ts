import os from "node:os";

export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number;
      const ipv4 = family === "IPv4" || family === 4;
      if (!ipv4 || entry.internal || entry.address.startsWith("169.254.")) continue;
      addresses.push(entry.address);
    }
  }
  return addresses;
}
