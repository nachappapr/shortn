import http from "k6/http";

export default function () {
  const urls = Array.from({ length: 1000 }, (_, i) => ({ 
    url: `https://example.com/page-${i}` 
  }));
  
  const res = http.post(
    "http://localhost:3000/v1/shorten/batch",
    JSON.stringify(urls),
    { headers: { "Content-Type": "application/json" }, timeout: "30s" }
  );
  
  console.log(`status: ${res.status}, duration: ${res.timings.duration}ms`);
}