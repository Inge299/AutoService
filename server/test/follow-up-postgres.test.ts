import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../src/http/errors.js";
import { followUpRoutes } from "../src/http/routes/follow-up.js";
import { reportRoutes } from "../src/http/routes/reports.js";
import { customerRoutes } from "../src/http/routes/customers.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("individual work planning with PostgreSQL", () => {
  const prisma = new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL!}}});
  const app = Fastify(), workshopId=randomUUID(), otherId=randomUUID(), userId=randomUUID(), customerId=randomUUID();
  let visitId:string, firstId:string, secondId:string, noDateId:string;
  const due1="2099-11-20T09:00:00.000Z",due2="2099-12-20T09:00:00.000Z",next="2099-12-01T09:00:00.000Z";
  beforeAll(async()=>{
    await prisma.workshop.create({data:{id:workshopId,name:"QA individual plans"}});
    await prisma.customer.create({data:{id:customerId,workshopId,name:"QA",phone:"+79991112233"}});
    registerErrorHandler(app);
    app.addHook("preHandler",async request=>{request.actor={workshopId:request.headers["x-qa-other"]?otherId:workshopId,userId,role:"EMPLOYEE"}});
    await app.register(followUpRoutes(prisma));await app.register(reportRoutes(prisma));await app.register(customerRoutes(prisma));
  });
  beforeEach(async()=>{
    visitId=randomUUID();firstId=randomUUID();secondId=randomUUID();noDateId=randomUUID();
    await prisma.visit.create({data:{id:visitId,workshopId,customerId,customerName:"QA",customerPhone:"+79991112233",vehicleLabel:"QA car",licensePlate:"Т111ТТ77",complaint:"Synthetic",status:"IN_REPAIR",createdAt:new Date(),updatedAt:new Date()}});
    for(const [id,title,due,configured] of [[firstId,"Ремень",due1,true],[secondId,"Фильтр",null,false],[noDateId,"Осмотр",null,true]] as const){
      await prisma.finding.create({data:{id,workshopId,visitId,title,description:"Synthetic",priority:"PLANNED",status:"DEFERRED",createdAt:new Date(),updatedAt:new Date(),followUpDueAt:due?new Date(due):null,followUpConfigured:configured}});
    }
    await prisma.report.create({data:{workshopId,visitId,completedWork:"Диагностика",recommendations:"Контроль",nextVisitAt:new Date(next)}});
  });
  afterAll(async()=>{await app.close();await prisma.workshop.delete({where:{id:workshopId}});await prisma.$disconnect()});
  const publish=async()=>{
    const body={operationId:randomUUID(),token:randomUUID().replaceAll("-","")+"testtoken"};
    const r=await app.inject({method:"POST",url:`/v1/visits/${visitId}/report/publish`,payload:body});expect(r.statusCode,r.body).toBe(201);
    return {versionId:r.json().reportVersionId as string,body};
  };
  const plan=(id:string,state="OPEN",dueAt:string|null=due2,version=1,foreign=false)=>app.inject({method:"PUT",url:`/v1/findings/${id}/follow-up`,headers:foreign?{"x-qa-other":"1"}:{},payload:{baseServerVersion:version,state,dueAt}});
  it("publishes one immutable snapshot and one reminder per dated work, including retry",async()=>{
    const {versionId,body}=await publish();
    const reminders=await prisma.reminder.findMany({where:{reportVersionId:versionId}});expect(reminders).toHaveLength(2);
    expect(reminders.find(r=>r.findingId===firstId)?.dueAt.toISOString()).toBe(due1);
    expect(reminders.find(r=>r.findingId===secondId)?.dueAt.toISOString()).toBe(next);
    const version=await prisma.reportVersion.findUniqueOrThrow({where:{id:versionId}});
    expect(version.recommendations).toContain("Ремень. Необходимо выполнить в дальнейшем. Рекомендуемый срок: до 20.11.2099.");
    expect(version.recommendations).toContain("Осмотр. Необходимо выполнить в дальнейшем. Срок необходимо согласовать");
    expect((await app.inject({method:"POST",url:`/v1/visits/${visitId}/report/publish`,payload:body})).statusCode).toBe(200);
    expect(await prisma.reminder.count({where:{reportVersionId:versionId}})).toBe(2);
  });
  it("reschedules only the selected work and never rewrites the published report",async()=>{
    const {versionId}=await publish(),before=await prisma.reportVersion.findUniqueOrThrow({where:{id:versionId}});
    const r=await plan(firstId);expect(r.statusCode,r.body).toBe(200);
    const rows=await prisma.reminder.findMany({where:{reportVersionId:versionId}});
    expect(rows.filter(x=>x.findingId===firstId&&x.state==="PENDING").map(x=>x.dueAt.toISOString())).toEqual([due2]);
    expect(rows.filter(x=>x.findingId===firstId&&x.state==="CANCELLED")).toHaveLength(1);
    expect(rows.find(x=>x.findingId===secondId)?.state).toBe("PENDING");
    expect(await prisma.backgroundJob.count({where:{reminder:{findingId:firstId},state:"DEAD"}})).toBe(1);
    expect((await prisma.reportVersion.findUniqueOrThrow({where:{id:versionId}})).recommendations).toBe(before.recommendations);
  });
  it("completes later work separately from the original decision and cancels its job",async()=>{
    await publish();const r=await plan(secondId,"DONE",next);expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({status:"DEFERRED",followUpState:"DONE"});expect(r.json().followUpCompletedAt).toBeTruthy();
    expect(await prisma.reminder.count({where:{findingId:secondId,state:"PENDING"}})).toBe(0);
    expect(await prisma.reminder.count({where:{findingId:firstId,state:"PENDING"}})).toBe(1);
    const history=await app.inject({url:`/v1/customers/${customerId}/history`});
    expect(history.json().futureWork.items.some((f:{id:string})=>f.id===secondId)).toBe(false);
  });
  it("rejects stale versions, invalid dates and foreign access without cancelling reminders",async()=>{
    await publish();expect((await plan(firstId,"OPEN",due2,99)).statusCode).toBe(409);
    expect((await plan(firstId,"OPEN","2000-01-01T12:00:00Z")).statusCode).toBe(400);
    expect((await plan(firstId,"OPEN",due2,1,true)).statusCode).toBe(404);
    expect(await prisma.reminder.count({where:{findingId:firstId,state:"PENDING"}})).toBe(1);
  });
  it("supports no deadline and reopening without creating an undated SMS job",async()=>{
    await publish();expect((await plan(firstId,"CANCELLED",null)).statusCode).toBe(200);
    expect((await plan(firstId,"OPEN",null,2)).statusCode).toBe(200);
    expect(await prisma.reminder.count({where:{findingId:firstId,state:"PENDING"}})).toBe(0);
  });
  it("keeps a future reminder schedulable after the public report link expires",async()=>{
    const {versionId}=await publish();
    await prisma.reportLink.update({where:{reportVersionId:versionId},data:{expiresAt:new Date("2000-01-01T00:00:00Z")}});
    expect((await plan(firstId)).statusCode).toBe(200);
    expect(await prisma.reminder.count({where:{findingId:firstId,state:"PENDING",dueAt:new Date(due2)}})).toBe(1);
  });
  it("allows one winner for concurrent changes",async()=>{
    await publish();const results=await Promise.all([plan(firstId),plan(firstId,"DONE",due1)]);
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
    expect(await prisma.reminder.count({where:{findingId:firstId,state:"PENDING"}})).toBeLessThanOrEqual(1);
  });
  it("splits an old combined reminder without losing other works",async()=>{
    const {versionId}=await publish();
    await prisma.backgroundJob.deleteMany({where:{reminder:{reportVersionId:versionId}}});await prisma.reminder.deleteMany({where:{reportVersionId:versionId}});
    const old=await prisma.reminder.create({data:{workshopId,reportVersionId:versionId,visitId,customerName:"QA",customerPhone:"+79991112233",vehicleLabel:"QA",reason:"Legacy combined",dueAt:new Date(next),sendAt:new Date(next)}});
    await prisma.backgroundJob.create({data:{workshopId,reminderId:old.id,type:"SEND_REMINDER_SMS",payload:{reminderId:old.id},idempotencyKey:`legacy:${old.id}`,runAfter:new Date(next)}});
    expect((await plan(firstId,"DONE",due1)).statusCode).toBe(200);
    expect((await prisma.reminder.findUniqueOrThrow({where:{id:old.id}})).state).toBe("CANCELLED");
    expect(await prisma.reminder.count({where:{reportVersionId:versionId,findingId:secondId,state:"PENDING"}})).toBe(1);
    expect(await prisma.backgroundJob.count({where:{reminderId:old.id,state:"DEAD"}})).toBe(1);
  });
});
