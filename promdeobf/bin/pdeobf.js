#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: node pdeobf.js <input.lua>");
  process.exit(1);
}

const inputPath = path.resolve(args[0]);
const outputPath = inputPath.replace(/\.lua$/i, ".deobf.lua");
let code = fs.readFileSync(inputPath, "utf8");

// ===== PROMETHEUS DEOBFUSCATOR =====
function deobfuscate(code) {
  code = code.replace(/^\s*--[^\n]*$/gm, "");
  const arrMatch = code.match(/local\s+(\w+)\s*=\s*\{([^}]+)\}/);
  if (arrMatch) {
    const arrName = arrMatch[1];
    const items = arrMatch[2].split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
    code = code.replace(new RegExp(`${arrName}\\s*\\[(\\d+)\\]`, "g"), (_, i) => `"${items[parseInt(i)-1] || ''}"`);
  }
  const varMap = {};
  const varAssign = code.match(/local\s+(\w+)\s*=\s*([\d.]+|".*?")/g);
  if (varAssign) {
    varAssign.forEach(line => {
      const m = line.match(/local\s+(\w+)\s*=\s*(.+)/);
      if (m && !m[2].includes("function") && !m[2].includes("{")) {
        varMap[m[1]] = m[2];
      }
    });
    Object.keys(varMap).forEach(v => {
      code = code.replace(new RegExp(`\\b${v}\\b`, "g"), varMap[v]);
    });
  }
  code = code.split("\n").filter(l => l.trim() !== "").join("\n");
  return code;
}

const result = deobfuscate(code);
fs.writeFileSync(outputPath, result, "utf8");
console.log(outputPath);
