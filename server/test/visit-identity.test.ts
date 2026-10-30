import type { Prisma, Customer, Vehicle, Visit } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { resolveVisitIdentity } from "../src/domain/visit-identity.js";

const workshopId = "workshop", customerId = "customer", vehicleId = "vehicle";
const body = { customerName: "Synthetic", customerPhone: "+79990000000", vehicleLabel: "Toyota renamed", licensePlate: "А123АА77" };
function setup(legacyMatches = [customerId], carMatches = [vehicleId]) {
  const customer = { id: customerId, phone: "8 (999) 000-00-00" } as Customer;
  const vehicle = { id: vehicleId, licensePlate: body.licensePlate } as Vehicle;
  const tx = { $queryRaw: vi.fn().mockResolvedValueOnce(legacyMatches.map(id => ({ id }))).mockResolvedValueOnce(carMatches.map(id => ({ id }))),
    customer: { findFirst: vi.fn().mockResolvedValue(customer), create: vi.fn().mockResolvedValue(customer), update: vi.fn().mockResolvedValue(customer) },
    vehicle: { findFirst: vi.fn().mockResolvedValue(vehicle), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(vehicle), update: vi.fn().mockResolvedValue(vehicle) } };
  return { tx, db: tx as unknown as Prisma.TransactionClient };
}
describe("stable visit identity", () => {
  it("uses a legacy formatted phone without creating another customer and renames the existing car", async () => {
    const { tx, db } = setup();
    const result = await resolveVisitIdentity(db, workshopId, body, null);
    expect(result.customer.id).toBe(customerId); expect(result.vehicle.id).toBe(vehicleId);
    expect(tx.customer.create).not.toHaveBeenCalled(); expect(tx.vehicle.create).not.toHaveBeenCalled();
    expect(tx.vehicle.update).toHaveBeenCalledWith({ where: { id: vehicleId }, data: { label: body.vehicleLabel, licensePlate: body.licensePlate } });
  });
  it("keeps the linked car when its label and plate change on an existing visit", async () => {
    const { tx, db } = setup();
    await resolveVisitIdentity(db, workshopId, body, { customerId, vehicleId } as Visit);
    expect(tx.vehicle.create).not.toHaveBeenCalled();
    expect(tx.vehicle.findFirst).toHaveBeenCalledWith({ where: { id: vehicleId, workshopId, customerId } });
  });
  it("does not merge ambiguous legacy customer records", async () => {
    const { tx, db } = setup([customerId, "duplicate"]);
    await expect(resolveVisitIdentity(db, workshopId, body, null)).rejects.toMatchObject({ code: "customer_identity_ambiguous" });
    expect(tx.customer.update).not.toHaveBeenCalled();
  });
  it("does not silently choose one of two cars with the same plate", async () => {
    const { tx, db } = setup([customerId], [vehicleId, "duplicate"]);
    await expect(resolveVisitIdentity(db, workshopId, body, null)).rejects.toMatchObject({ code: "vehicle_identity_ambiguous" });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });
  it("accepts explicit IDs for the selected existing car without recreating it", async () => {
    const { tx, db } = setup();
    await resolveVisitIdentity(db, workshopId, { ...body, customerId, vehicleId }, null);
    expect(tx.$queryRaw).not.toHaveBeenCalled(); expect(tx.vehicle.create).not.toHaveBeenCalled();
  });
  it("rejects a selected client whose phone no longer matches the submitted number", async () => {
    const { tx, db } = setup();
    await expect(resolveVisitIdentity(db, workshopId, { ...body, customerId, customerPhone: "+79990000001" }, null)).rejects.toMatchObject({ code: "customer_identity_mismatch" });
    expect(tx.customer.update).not.toHaveBeenCalled();
  });
  it("rejects a car outside the selected customer's workshop", async () => {
    const { tx, db } = setup(); tx.vehicle.findFirst.mockResolvedValue(null as unknown as Vehicle);
    await expect(resolveVisitIdentity(db, workshopId, { ...body, customerId, vehicleId }, null)).rejects.toMatchObject({ code: "vehicle_identity_mismatch" });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });
});
