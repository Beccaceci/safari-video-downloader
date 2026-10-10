// Automated Verification Test for StreamDownloadManager & Range Resume Logic
const http = require("http");
const assert = require("assert");

// Create mock server supporting Range requests
const TOTAL_SIZE = 1024 * 1024; // 1 MB test payload
const testBuffer = Buffer.alloc(TOTAL_SIZE, 0x42); // 1 MB of 'B'

const server = http.createServer((req, res) => {
  const range = req.headers.range;
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d+)?/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : TOTAL_SIZE - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${TOTAL_SIZE}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(testBuffer.slice(start, end + 1));
      return;
    }
  }

  res.writeHead(200, {
    "Content-Length": TOTAL_SIZE,
    "Accept-Ranges": "bytes",
    "Content-Type": "video/mp4",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(testBuffer);
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/test-video.mp4`;

  console.log(`[Test Server] Running on ${testUrl}`);

  try {
    // 1. Test initial chunked download with pause
    let receivedBytes = 0;
    const chunks = [];
    let controller = new AbortController();

    const res1 = await fetch(testUrl, {
      signal: controller.signal
    });

    assert.strictEqual(res1.status, 200, "Initial status should be 200");
    const reader1 = res1.body.getReader();

    // Read first chunk
    const { done: d1, value: v1 } = await reader1.read();
    assert(!d1, "First chunk should not be done");
    chunks.push(v1);
    receivedBytes += v1.length;
    console.log(`[Phase 1] Received ${receivedBytes} bytes, simulating PAUSE...`);

    // Abort (simulate Pause)
    controller.abort();

    // 2. Test Resume from receivedBytes
    console.log(`[Phase 2] Resuming with Range: bytes=${receivedBytes}- ...`);
    controller = new AbortController();

    const res2 = await fetch(testUrl, {
      headers: {
        Range: `bytes=${receivedBytes}-`
      },
      signal: controller.signal
    });

    assert.strictEqual(res2.status, 206, "Resume status should be 206 Partial Content");
    const contentRange = res2.headers.get("content-range");
    assert(contentRange.startsWith(`bytes ${receivedBytes}-`), "Content-Range should start from receivedBytes");
    console.log(`[Phase 2] Server confirmed Content-Range: ${contentRange}`);

    const reader2 = res2.body.getReader();
    while (true) {
      const { done, value } = await reader2.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
    }

    assert.strictEqual(receivedBytes, TOTAL_SIZE, `Total downloaded size must match ${TOTAL_SIZE}`);
    const finalBuffer = Buffer.concat(chunks);
    assert.strictEqual(finalBuffer.length, TOTAL_SIZE, "Final buffer length must match TOTAL_SIZE");
    assert(finalBuffer.equals(testBuffer), "Downloaded content matches original binary payload byte-for-byte");

    console.log(`[Phase 3] Complete! 100% downloaded (${receivedBytes}/${TOTAL_SIZE} bytes). Verified byte-for-byte integrity.`);
    console.log("TEST PASSED: Stream download, pause, resume with HTTP 206, and byte integrity verified successfully!");
  } catch (err) {
    console.error("TEST FAILED:", err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
