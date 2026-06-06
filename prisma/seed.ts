import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin12345!";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      displayName: "管理员",
      role: "ADMIN",
      isBanned: false,
    },
    create: {
      username: "admin",
      displayName: "管理员",
      passwordHash,
      role: "ADMIN",
      virtualChips: 100000,
      stats: { create: {} },
    },
  });

  const demoHash = await bcrypt.hash("Player12345!", 12);
  for (const username of ["alice", "bob"]) {
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        displayName: username === "alice" ? "阿丽" : "阿博",
        passwordHash: demoHash,
        virtualChips: 20000,
        stats: { create: {} },
      },
    });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
