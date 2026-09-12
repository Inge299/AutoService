import { MembershipRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const workshopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

try {
  await prisma.$transaction([
    prisma.workshop.upsert({
      where: { id: workshopId },
      update: {},
      create: { id: workshopId, name: "Локальная мастерская" },
    }),
    prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, phone: "+79990000000", displayName: "Локальный мастер" },
    }),
    prisma.membership.upsert({
      where: { workshopId_userId: { workshopId, userId } },
      update: { role: MembershipRole.ADMIN },
      create: { workshopId, userId, role: MembershipRole.ADMIN },
    }),
  ]);
} finally {
  await prisma.$disconnect();
}
