// Builds apps-script/Index.html: the booking page with its CSS and scripts
// inlined, as Apps Script's HtmlService needs a single file.
// Run after changing index.html, styles.css, config.js or app.js:
//   node build-apps-script.js
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let html = read("index.html")
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${read("styles.css")}</style>`)
  .replace('<script src="config.js"></script>', () => `<script>\n${read("config.js")}</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${read("app.js")}</script>`);

if (/(href|src)="(styles\.css|config\.js|app\.js)"/.test(html)) throw new Error("Inlining failed");
fs.writeFileSync(path.join(__dirname, "apps-script", "Index.html"), html);
console.log("Wrote apps-script/Index.html");
