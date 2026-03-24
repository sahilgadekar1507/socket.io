import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const app = express();
const srver = createServer(app);

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get("/", (req, res) => {
    res.sendFile(join(__dirname , "index.html"));
});

app.listen(3000, () => {
    console.log("server is listening on the port http://localhost:3000"); 
});