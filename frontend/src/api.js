import axios from "axios";

const base = process.env.NEXT_PUBLIC_API_BASE || "/api";
const client = axios.create({ baseURL: base });

export async function health() {
  return (await client.get("/health")).data;
}
export async function uploadAnalysis(file) {
  const form = new FormData();
  form.append("file", file);
  return (await client.post("/analyses", form)).data;
}
export async function listAnalyses() {
  return (await client.get("/analyses")).data;
}
export async function getImageUrl(id) {
  return (await client.get(`/analyses/${id}/image`)).data.url;
}
export async function buildReport(id) {
  return (await client.post(`/analyses/${id}/report`)).data.url;
}
