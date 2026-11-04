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
  // Seed is an initial-install operation, not a source of production users.
  // Never recreate deleted accounts when an administrator already exists.
  await prisma.$transaction(async (tx) => {
    const initialized = await tx.membership.findFirst({
      where: { role: MembershipRole.ADMIN },
      select: { userId: true },
    });
    if (initialized) return;
    const adminLogin = process.env.BOOTSTRAP_ADMIN_LOGIN?.trim().toLocaleLowerCase("ru-RU");
    const adminPasswordHash = process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH?.trim();
    if (!adminLogin || !adminPasswordHash) {
      throw new Error("Initial seed requires BOOTSTRAP_ADMIN_LOGIN and BOOTSTRAP_ADMIN_PASSWORD_HASH");
    }
    if (!/^[0-9a-f]{32}:[0-9a-f]{128}$/i.test(adminPasswordHash)) {
      throw new Error("BOOTSTRAP_ADMIN_PASSWORD_HASH must be a valid scrypt hash");
    }
    const initialAdminLogin = adminLogin;
    const initialAdminPasswordHash = adminPasswordHash;
    const existingAdmin = await tx.user.findUnique({ where: { id: userId } });
    if (existingAdmin) throw new Error("Bootstrap user already exists without an admin membership; resolve manually");
    await tx.workshop.upsert({
      where: { id: workshopId }, update: {}, create: { id: workshopId, name: "Локальная мастерская" },
    });
    await tx.user.create({
      data: {
        id: userId,
        login: initialAdminLogin,
        phone: "+79990000000",
        passwordHash: initialAdminPasswordHash,
        mustChangePassword: false,
        displayName: process.env.BOOTSTRAP_ADMIN_NAME || "Локальный мастер",
      },
    });
    await tx.membership.upsert({
      where: { workshopId_userId: { workshopId, userId } },
      update: {},
      create: { workshopId, userId, role: MembershipRole.ADMIN },
    });

    for (const user of bootstrapUsers()) {
      await tx.workshop.upsert({
        where: { id: user.workshopId },
        update: {},
        create: { id: user.workshopId, name: "Мастерская" },
      });
      const existingUser = await tx.user.findUnique({ where: { id: user.userId } });
      await tx.user.upsert({
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
      await tx.membership.upsert({
        where: { workshopId_userId: { workshopId: user.workshopId, userId: user.userId } },
        update: {},
        create: { workshopId: user.workshopId, userId: user.userId, role: user.role as MembershipRole },
      });
    }
  });
} finally {
  await prisma.$disconnect();
}
