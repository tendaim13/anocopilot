import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { Command, MemorySaver } from "@langchain/langgraph";

import { researchBriefSchema } from "@/lib/ano/research-conversation";
import {
  createAutopilotIntakePlanningModel,
  evaluateTwoQuestionIntake,
  extractIntakeHintsFromText,
} from "@/server/agents/research-planning-model";
import {
  detectUrlsInText,
  formatProductSourcesForPrompt,
  ingestProductFile,
  ingestProductUrl,
  MAX_FILE_BYTES,
  ProductIngestionError,
} from "@/server/ingestion/product-source-ingestor";
import { createResearchGraph } from "@/server/langgraph/research-graph";

function buildMinimalPdf(sentence: string): Uint8Array {
  const safeText = sentence.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const contentStream = `BT /F1 12 Tf 72 720 Td (${safeText}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildMinimalZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawBuf = Buffer.from(entry.content, "utf8");
    const compressed = deflateRawSync(rawBuf);
    const checksum = crc32(rawBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...localChunks, centralDir, eocd]));
}

function buildMinimalDocx(paragraph: string): Uint8Array {
  const escaped = paragraph
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return buildMinimalZip([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ]);
}

test("ingestProductFile parses TXT, PDF, DOCX cleanly and rejects unsupported or corrupt files", async () => {
  const txtRes = await ingestProductFile({
    fileName: "product-brief.txt",
    mimeType: "text/plain",
    bytes: new Uint8Array(
      Buffer.from("RecallFlow automates overdue patient recall SMS reminders for dental clinics."),
    ),
  });
  assert.equal(txtRes.sourceType, "txt");
  assert.match(txtRes.extractedText, /RecallFlow automates/);
  assert.equal(txtRes.contentSha256.length, 64);

  const pdfRes = await ingestProductFile({
    fileName: "recallflow-deck.pdf",
    mimeType: "application/pdf",
    bytes: buildMinimalPdf(
      "RecallFlow helps multi-chair dental clinics book overdue cleanings automatically.",
    ),
  });
  assert.equal(pdfRes.sourceType, "pdf");
  assert.match(pdfRes.extractedText, /RecallFlow helps multi-chair dental clinics/);

  const docxRes = await ingestProductFile({
    fileName: "overview.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: buildMinimalDocx(
      "RecallFlow integrates with clinic calendars to reduce no-shows by 32 percent.",
    ),
  });
  assert.equal(docxRes.sourceType, "docx");
  assert.match(docxRes.extractedText, /RecallFlow integrates with clinic calendars/);

  await assert.rejects(
    () =>
      ingestProductFile({
        fileName: "legacy.doc",
        mimeType: "application/msword",
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    (err: unknown) => err instanceof ProductIngestionError && err.code === "UNSUPPORTED_FORMAT",
  );

  await assert.rejects(
    () =>
      ingestProductFile({
        fileName: "fake.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array(Buffer.from("NOT_A_PDF_FILE_CONTENT")),
      }),
    (err: unknown) => err instanceof ProductIngestionError && err.code === "INVALID_FILE",
  );

  await assert.rejects(
    () =>
      ingestProductFile({
        fileName: "too-big.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array(MAX_FILE_BYTES + 1),
      }),
    (err: unknown) => err instanceof ProductIngestionError && err.code === "FILE_TOO_LARGE",
  );

  const formatted = formatProductSourcesForPrompt([txtRes, pdfRes]);
  assert.match(formatted, /product-brief\.txt/);
  assert.match(formatted, /recallflow-deck\.pdf/);
});

test("ingestProductUrl crawls main page + features link safely and enforces SSRF private IP blocks", async () => {
  const urlsFound = detectUrlsInText("Check https://recallflow.example/demo, thanks!");
  assert.deepEqual(urlsFound, ["https://recallflow.example/demo"]);

  const crawled = await ingestProductUrl("https://recallflow.example", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: (async (input) => {
      const target = String(input);
      if (target.endsWith("/features")) {
        return new Response(
          "<html><head><title>Features</title></head><body><p>Two-way WhatsApp and SMS recall campaigns built for private clinics.</p></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response(
        '<html><head><title>RecallFlow</title></head><body><script>window.x=1;</script><main><h1>RecallFlow Dental Automation</h1><p>Turn dormant patient lists into recurring chair revenue.</p><a href="/features">Product Features</a></main></body></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }) as typeof fetch,
  });

  assert.equal(crawled.sourceType, "website_url");
  assert.equal(crawled.label, "recallflow.example");
  assert.match(crawled.extractedText, /Turn dormant patient lists/);
  assert.match(crawled.extractedText, /Two-way WhatsApp and SMS recall/);
  assert.equal(crawled.extractedText.includes("window.x=1"), false);

  await assert.rejects(
    () =>
      ingestProductUrl("http://localhost:3000/secret", {
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    (err: unknown) => err instanceof ProductIngestionError && err.code === "UNSAFE_URL",
  );

  await assert.rejects(
    () =>
      ingestProductUrl("https://internal.corp.example", {
        lookup: async () => [{ address: "10.0.0.12", family: 4 }],
      }),
    (err: unknown) => err instanceof ProductIngestionError && err.code === "UNSAFE_URL",
  );
});

test("2-question intake asks only missing location/target markets and autopilot researchGraph skips manual plan approval", async () => {
  const hints1 = extractIntakeHintsFromText(
    "We are based in Kuala Lumpur and looking to sell to Malaysia and Singapore.",
  );
  assert.equal(hints1.businessLocation, "Kuala Lumpur");
  assert.deepEqual(hints1.targetMarkets, ["Malaysia", "Singapore"]);

  const baseBrief = researchBriefSchema
    .omit({ sourceMessageIds: true })
    .parse({
      offer: "Automated dental recall software",
      goal: "Find dental clinics to pitch",
      marketHints: [],
      locationHints: [],
      buyerHints: [],
      constraints: [],
      unknowns: [],
    });

  const missingBoth = evaluateTwoQuestionIntake({
    offer: baseBrief.offer,
    brief: baseBrief,
    userMessages: ["Analyze our product PDF"],
  });
  assert.equal(missingBoth.intakeComplete, false);
  assert.match(missingBoth.clarification?.question ?? "", /1\. Where is your business located/);
  assert.match(missingBoth.clarification?.question ?? "", /2\. Where do you want to sell/);

  const missingTarget = evaluateTwoQuestionIntake({
    offer: baseBrief.offer,
    brief: baseBrief,
    userMessages: ["Our office is based in Melbourne, Australia."],
  });
  assert.equal(missingTarget.intakeComplete, false);
  assert.equal(missingTarget.businessLocation, "Melbourne, Australia");
  assert.match(missingTarget.clarification?.question ?? "", /Where do you want to sell/);

  const completedWithFollowup = evaluateTwoQuestionIntake({
    offer: baseBrief.offer,
    brief: baseBrief,
    userMessages: ["Our office is based in Melbourne, Australia.", "Recommend the best market for me."],
  });
  assert.equal(completedWithFollowup.intakeComplete, true);
  assert.equal(completedWithFollowup.businessLocation, "Melbourne, Australia");
  assert.deepEqual(completedWithFollowup.targetMarkets, ["Recommend best market"]);

  const mockLlm = {
    async invoke() {
      return {
        content: JSON.stringify({
          outcome: "ready",
          brief: {
            offer: "RecallFlow dental recall SaaS",
            goal: "Find clinics to pitch",
            businessLocation: null,
            targetMarkets: [],
            marketHints: ["Dental clinics"],
            locationHints: [],
            buyerHints: ["Practice Manager"],
            constraints: [],
            unknowns: [],
          },
        }),
      };
    },
  };

  const intakeModel = createAutopilotIntakePlanningModel(
    {
      region: "us-east-1",
      modelId: "test-model",
      guardrailIdentifier: "unused",
      guardrailVersion: "1",
    },
    { productContextText: "RecallFlow dental software", modelOverride: mockLlm },
  );

  const graph = createResearchGraph(intakeModel, new MemorySaver(), { autopilotIntake: true });
  const cfg = { configurable: { thread_id: "phase10b-autopilot-intake" } };

  await graph.invoke(
    {
      workspaceId: "00000000-0000-4000-8000-000000002001",
      conversationId: "00000000-0000-4000-8000-000000002002",
      graphRunId: "00000000-0000-4000-8000-000000002003",
      submittedMessage: {
        id: "00000000-0000-4000-8000-000000002004",
        text: "We are based in Penang, Malaysia.",
      },
    },
    cfg,
  );

  const paused = await graph.getState(cfg);
  assert.equal(paused.values.status, "awaiting_context");
  assert.match(paused.values.pendingQuestion?.question ?? "", /Where do you want to sell/);

  await graph.invoke(
    new Command({
      resume: {
        kind: "clarification",
        answer: "Singapore",
        messageId: "00000000-0000-4000-8000-000000002005",
      },
    }),
    cfg,
  );

  const done = await graph.getState(cfg);
  assert.equal(done.values.status, "complete_without_research");
  assert.equal(done.values.plan?.approvalStatus, "approved");
  assert.equal(done.values.brief?.businessLocation, "Penang, Malaysia");
  assert.deepEqual(done.values.brief?.targetMarkets, ["Singapore"]);
  assert.equal(done.values.brief?.intakeComplete, true);
});
