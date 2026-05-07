// 500-server.js
import http from "http";

let attempts = 0;

http
  .createServer((req, res) => {
    attempts++;
    console.log(`Attempt ${attempts}`);
    res.writeHead(200);
    res.end("received");
  })
  .listen(4000, () => console.log("200 server on :4000"));
