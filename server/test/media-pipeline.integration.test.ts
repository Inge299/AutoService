import { PrismaClient } from "@prisma/client";
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { ObjectStorage } from "../src/infrastructure/object-storage.js";

// Explicit opt-in only: TEST_DATABASE_URL must point at a dedicated synthetic database.
const { TEST_DATABASE_URL: databaseUrl, QA_S3_ENDPOINT: endpoint, QA_S3_ACCESS_KEY: accessKey, QA_S3_SECRET_KEY: secretKey } = process.env;
const enabled = Boolean(databaseUrl && endpoint && accessKey && secretKey && process.env.QA_MEDIA_PIPELINE === "true");
describe.skipIf(!enabled)("real storage media pipeline", () => {
  const bucket = `autoservice-qa-${randomBytes(10).toString("hex")}`;
  const workshopId = randomUUID(), visitId = randomUUID(), findingId = randomUUID(), mediaId = randomUUID();
  const original = `qa/${mediaId}/original`, verified = `qa/${mediaId}/verified`;
  const body = Buffer.from("synthetic media for isolated queue test\n");
  const hash = createHash("sha256").update(body).digest("hex");
  const reportToken = `report_${randomBytes(24).toString("hex")}`;
  const approvalToken = `approval_${randomBytes(24).toString("hex")}`;
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  let client: S3Client, prisma: PrismaClient, worker: ChildProcess | undefined;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let bucketCreated = false;
  beforeAll(async () => {
    if (!databaseUrl || !/\/autoservice_[a-z0-9_]*_test(?:\?|$)/.test(databaseUrl)) throw new Error("A dedicated autoservice_*_test database is required");
    const config: Config = { NODE_ENV:"test", HOST:"127.0.0.1", PORT:8080, LOG_LEVEL:"silent", SMS_PROVIDER:"disabled", DATABASE_URL:databaseUrl,
      S3_ENDPOINT:endpoint!, S3_REGION:"ru-central1", S3_BUCKET:bucket, S3_ACCESS_KEY_ID:accessKey!, S3_SECRET_ACCESS_KEY:secretKey!, S3_FORCE_PATH_STYLE:true, WORKER_POLL_INTERVAL_MS:100 };
    client = new S3Client({ region:config.S3_REGION, endpoint:endpoint!, forcePathStyle:true, credentials:{accessKeyId:accessKey!,secretAccessKey:secretKey!} });
    await client.send(new CreateBucketCommand({Bucket:bucket})); bucketCreated=true;
    prisma = new PrismaClient({datasources:{db:{url:databaseUrl}}});
    await prisma.workshop.create({data:{id:workshopId,name:"Synthetic QA"}});
    await prisma.visit.create({data:{id:visitId,workshopId,customerName:"QA",customerPhone:"+70000000000",vehicleLabel:"QA car",licensePlate:"",complaint:"Synthetic",status:"IN_REPAIR",createdAt:new Date(),updatedAt:new Date()}});
    await prisma.finding.create({data:{id:findingId,workshopId,visitId,title:"QA work",description:"Synthetic",priceRub:100,priority:"IMPORTANT",status:"SENT_TO_CUSTOMER",createdAt:new Date(),updatedAt:new Date()}});
    await client.send(new PutObjectCommand({Bucket:bucket,Key:original,Body:body,ContentType:"image/jpeg",Metadata:{sha256:hash}}));
    await prisma.mediaAsset.create({data:{id:mediaId,operationId:randomUUID(),workshopId,visitId,findingId,kind:"PHOTO",mimeType:"image/jpeg",byteCount:BigInt(body.length),sha256:hash,objectKey:original,state:"READY"}});
    const report = await prisma.report.create({data:{workshopId,visitId,completedWork:"QA"}});
    await prisma.reportVersion.create({data:{operationId:randomUUID(),reportId:report.id,workshopId,visitId,version:1,customerName:"QA",customerPhone:"+70000000000",vehicleLabel:"QA car",licensePlate:"",complaint:"Synthetic",completedWork:"QA",recommendations:"",findings:[{id:findingId,title:"QA work",status:"SENT_TO_CUSTOMER"}],mediaIds:[mediaId],mediaManifest:[{id:mediaId,findingId}],link:{create:{tokenHash:sha(reportToken),expiresAt:new Date(Date.now()+60_000)}}}});
    await prisma.approvalVersion.create({data:{operationId:randomUUID(),workshopId,visitId,findingId,version:1,title:"QA work",description:"Synthetic",priceRub:100,mediaIds:[mediaId],link:{create:{tokenHash:sha(approvalToken),expiresAt:new Date(Date.now()+60_000)}}}});
    app=await buildApp(config,{prisma,storage:new ObjectStorage(config)});
    await app.listen({host:"127.0.0.1",port:0});
  }, 30_000);
  afterAll(async () => {
    if (worker) { worker.kill("SIGTERM"); await new Promise<void>(resolve => { if (worker?.exitCode !== null || worker?.signalCode !== null) resolve(); else worker?.once("exit",()=>resolve()); }); }
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    if (bucketCreated) {
      for (const Key of [original,verified]) await client.send(new DeleteObjectCommand({Bucket:bucket,Key}));
      await client.send(new DeleteBucketCommand({Bucket:bucket}));
    }
    client?.destroy();
  },30_000);
  it("queues old report and approval media, prepares it in the worker, then serves signed evidence", async () => {
    const address=app.server.address();
    if (!address || typeof address === "string") throw new Error("Missing API address");
    const base=`http://127.0.0.1:${address.port}`;
    const report=()=>fetch(`${base}/public/v1/reports/${reportToken}`);
    const approval=()=>fetch(`${base}/public/v1/approvals/${approvalToken}`);
    for (const response of [await report(),await approval()]) { expect(response.status).toBe(503); expect(await response.json()).toEqual({error:"media_preparing"}); }
    expect(await prisma.backgroundJob.count({where:{idempotencyKey:`legacy-seal:${mediaId}`}})).toBe(1);
    expect((await prisma.reportLink.findFirstOrThrow({where:{reportVersion:{visitId}}})).openedAt).toBeNull();
    worker=spawn(process.execPath,["dist/worker.js"],{env:{...process.env,NODE_ENV:"test",DATABASE_URL:databaseUrl!,S3_ENDPOINT:endpoint!,S3_REGION:"ru-central1",S3_BUCKET:bucket,S3_ACCESS_KEY_ID:accessKey!,S3_SECRET_ACCESS_KEY:secretKey!,S3_FORCE_PATH_STYLE:"true",WORKER_POLL_INTERVAL_MS:"100",SMS_PROVIDER:"disabled"},stdio:"ignore"});
    let state="";
    for (let i=0;i<100;i++) { state=(await prisma.backgroundJob.findUniqueOrThrow({where:{idempotencyKey:`legacy-seal:${mediaId}`}})).state; if (["SUCCEEDED","DEAD"].includes(state)) break; await new Promise(resolve=>setTimeout(resolve,100)); }
    expect(state).toBe("SUCCEEDED");
    const reportResponse=await report(), approvalResponse=await approval();
    expect(reportResponse.status).toBe(200); expect(approvalResponse.status).toBe(200);
    const reportJson=await reportResponse.json() as {report:{media:{url:string}[]}};
    const approvalJson=await approvalResponse.json() as {media:{url:string}[]};
    for (const media of [reportJson.report.media,approvalJson.media]) {
      expect(media).toHaveLength(1); const downloaded=await fetch(media[0]!.url); expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(body);
    }
    if (process.env.QA_VERIFY_ANDROID === "true") {
      const publicEndpoint=process.env.QA_S3_PUBLIC_ENDPOINT;
      if (!publicEndpoint?.startsWith("https://")) throw new Error("QA_S3_PUBLIC_ENDPOINT must use HTTPS");
      const phoneStorage=new ObjectStorage({NODE_ENV:"test", HOST:"127.0.0.1", PORT:8080, LOG_LEVEL:"silent", SMS_PROVIDER:"disabled", DATABASE_URL:databaseUrl!,
        S3_ENDPOINT:endpoint!, S3_PUBLIC_ENDPOINT:publicEndpoint, S3_REGION:"ru-central1", S3_BUCKET:bucket,
        S3_ACCESS_KEY_ID:accessKey!, S3_SECRET_ACCESS_KEY:secretKey!, S3_FORCE_PATH_STYLE:true, WORKER_POLL_INTERVAL_MS:100});
      const target=await phoneStorage.createDownloadTarget(verified);
      const encoded=Buffer.from(target.url).toString("base64");
      let result: string;
      try {
        result=execFileSync("adb",["shell","am","instrument","-w","-r","-e","class","ru.autoservice.spike.PublicMediaHttpsTest",
          "-e","qaMediaUrlBase64",encoded,"-e","qaMediaSha256",hash,
          "ru.autoservice.spike.migrationqa20261103.test/androidx.test.runner.AndroidJUnitRunner"],{encoding:"utf8",timeout:45_000});
      } catch { throw new Error("Could not run Android HTTPS instrumentation"); }
      expect(result).toContain("OK (1 test)");
      expect(result).not.toContain("INSTRUMENTATION_STATUS_CODE: -3");
    }
    expect((await prisma.mediaAsset.findUniqueOrThrow({where:{id:mediaId}})).objectKey).toBe(verified);
    expect((await prisma.reportLink.findFirstOrThrow({where:{reportVersion:{visitId}}})).openedAt).not.toBeNull();
  },60_000);
});
