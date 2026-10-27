import { type Prisma, type Customer, type Vehicle, type Visit } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { normalizePlate } from "./license-plate.js";

interface IdentityInput { customerId?: string | undefined; vehicleId?: string | undefined;
  customerName: string; customerPhone: string; vehicleLabel: string; licensePlate: string }
export class IdentityConflict extends Error {
  constructor(public readonly code: "customer_identity_ambiguous" | "vehicle_identity_ambiguous" | "customer_identity_mismatch" | "vehicle_identity_mismatch") { super(code); }
}

export async function resolveVisitIdentity(tx: Prisma.TransactionClient, workshopId: string, body: IdentityInput, existing: Visit | null) {
  let customer: Customer | null = null;
  if (body.customerId) {
    customer = await tx.customer.findFirst({ where: { id: body.customerId, workshopId } });
    if (!customer || canonicalPhone(customer.phone) !== body.customerPhone) throw new IdentityConflict("customer_identity_mismatch");
  } else {
    // Legacy formatted phones are compared only inside the actor's workshop.
    // Ambiguous legacy duplicates require an explicit selection, never a merge.
    const matches = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers WHERE workshop_id = ${workshopId}::uuid AND
        (CASE
          WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
            THEN '7' || regexp_replace(phone, '[^0-9]', '', 'g')
          WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11 AND left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '8'
            THEN '7' || substring(regexp_replace(phone, '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(phone, '[^0-9]', '', 'g') END) = ${body.customerPhone.slice(1)}
      ORDER BY id`;
    if (matches.length > 1) {
      const same = matches.find(c => c.id === existing?.customerId);
      if (!same) throw new IdentityConflict("customer_identity_ambiguous");
      customer = await tx.customer.findFirst({ where: { id: same.id, workshopId } });
    } else if (matches[0]) customer = await tx.customer.findFirst({ where: { id: matches[0].id, workshopId } });
  }
  customer = customer
    ? await tx.customer.update({ where: { id: customer.id }, data: { name: body.customerName } })
    : await tx.customer.create({ data: { id: randomUUID(), workshopId, name: body.customerName, phone: body.customerPhone } });

  let vehicle: Vehicle | null = null;
  const vehicleId = body.vehicleId ?? (existing?.customerId === customer.id ? existing.vehicleId : null);
  if (vehicleId) {
    vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, workshopId, customerId: customer.id } });
    if (!vehicle) throw new IdentityConflict("vehicle_identity_mismatch");
    if (body.licensePlate && normalizePlate(vehicle.licensePlate) !== body.licensePlate) {
      const collisions = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM vehicles WHERE workshop_id = ${workshopId}::uuid AND customer_id = ${customer.id}::uuid
          AND id <> ${vehicle.id}::uuid
          AND translate(upper(regexp_replace(license_plate, '[[:space:]-]', '', 'g')), 'ABEKMHOPCTYX', 'АВЕКМНОРСТУХ') = ${body.licensePlate}`;
      if (collisions.length) throw new IdentityConflict("vehicle_identity_ambiguous");
    }
  } else {
    let ids: Array<{ id: string }>;
    if (body.licensePlate) {
      ids = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM vehicles WHERE workshop_id = ${workshopId}::uuid AND customer_id = ${customer.id}::uuid
          AND translate(upper(regexp_replace(license_plate, '[[:space:]-]', '', 'g')), 'ABEKMHOPCTYX', 'АВЕКМНОРСТУХ') = ${normalizePlate(body.licensePlate)}
        ORDER BY id`;
    } else {
      ids = await tx.vehicle.findMany({ where: { workshopId, customerId: customer.id, licensePlate: "", label: body.vehicleLabel }, select: { id: true } });
    }
    if (ids.length > 1) throw new IdentityConflict("vehicle_identity_ambiguous");
    if (ids[0]) vehicle = await tx.vehicle.findFirst({ where: { id: ids[0].id, workshopId, customerId: customer.id } });
  }
  vehicle = vehicle
    ? await tx.vehicle.update({ where: { id: vehicle.id }, data: { label: body.vehicleLabel, licensePlate: body.licensePlate } })
    : await tx.vehicle.create({ data: { id: randomUUID(), workshopId, customerId: customer.id, label: body.vehicleLabel, licensePlate: body.licensePlate } });
  return { customer, vehicle };
}

function canonicalPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return "+" + (digits.length === 10 ? "7" + digits : digits.length === 11 && digits.startsWith("8") ? "7" + digits.slice(1) : digits);
}
