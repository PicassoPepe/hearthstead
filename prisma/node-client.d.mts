import type { PrismaClient } from "@prisma/client";

/** Node-only client (pg adapter). Do not use this on Cloudflare Workers. */
export function createNodePrisma(url?: string): PrismaClient;
