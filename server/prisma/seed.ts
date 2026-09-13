import { MembershipRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const workshopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

interface BootstrapUser {
  login: string;
  passwordHash: string;
  userId: string;
  workshopId: string;
  displayName: string;
  role: "ADMIN" | "EMPLOYEE";
}

function bootstrapUsers(): BootstrapUser[] {
  try {
    const parsed: unknown = JSON.parse(process.env.BOOTSTRAP_USERS_JSON || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is BootstrapUser => {
      if (!value || typeof value !== "object") return false;
      const user = value as Partial<BootstrapUser>;
      return typeof user.login === "string" && typeof user.passwordHash === "string" &&
        typeof user.userId === "string" && typeof user.workshopId === "string" &&
        typeof user.displayName === "string" && (user.role === "ADMIN" || user.role === "EMPLOYEE");
    });
  } catch {
    return [];
  }
}

try {
  await prisma.workshop.upsert({
      where: { id: workshopId },
      update: {},
      create: { id: workshopId, name: "Локальная мастерская" },
    });

  const adminLogin = process.env.BOOTSTRAP_ADMIN_LOGIN?.trim().toLocaleLowerCase("ru-RU");
  const adminPasswordHash = process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH?.trim();
  const existingAdmin = await prisma.user.findUnique({ where: { id: userId } });
  await prisma.user.upsert({
      where: { id: userId },
      update: {
        ...(!existingAdmin?.login && adminLogin ? { login: adminLogin } : {}),
        ...(!existingAdmin?.passwordHash && adminPasswordHash ? { passwordHash: adminPasswordHash } : {}),
        ...(!existingAdmin?.passwordHash ? { displayName: process.env.BOOTSTRAP_ADMIN_NAME || "Локальный мастер" } : {}),
      },
      create: {
        id: userId,
        login: adminLogin || null,
        phone: "+79990000000",
        passwordHash: adminPasswordHash || null,
        displayName: process.env.BOOTSTRAP_ADMIN_NAME || "Локальный мастер",
      },
    });
  await prisma.membership.upsert({
      where: { workshopId_userId: { workshopId, userId } },
      update: {},
      create: { workshopId, userId, role: MembershipRole.ADMIN },
    });

  for (const user of bootstrapUsers()) {
    await prisma.workshop.upsert({
      where: { id: user.workshopId },
      update: {},
      create: { id: user.workshopId, name: "Мастерская" },
    });
    const existingUser = await prisma.user.findUnique({ where: { id: user.userId } });
    await prisma.user.upsert({
      where: { id: user.userId },
      update: {
        ...(!existingUser?.login ? { login: user.login.toLocaleLowerCase("ru-RU") } : {}),
        ...(!existingUser?.passwordHash ? { passwordHash: user.passwordHash, displayName: user.displayName } : {}),
      },
      create: {
        id: user.userId,
        login: user.login.toLocaleLowerCase("ru-RU"),
        passwordHash: user.passwordHash,
        displayName: user.displayName,
      },
    });
    await prisma.membership.upsert({
      where: { workshopId_userId: { workshopId: user.workshopId, userId: user.userId } },
      update: {},
      create: { workshopId: user.workshopId, userId: user.userId, role: user.role as MembershipRole },
    });
  }
} finally {
  await prisma.$disconnect();
}
