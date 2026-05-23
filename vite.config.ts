import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const supported = new Set([".html", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);

function displayName(file: string) {
  return path
    .basename(file, path.extname(file))
    .replace(/^\d+[-_\s]*/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function markdownFile(file: string, fallback: string) {
  if (!fs.existsSync(file)) return fallback;
  const parsed = matter(fs.readFileSync(file, "utf8"));
  return String(parsed.content || fallback).trim();
}

function quorumContent(): Plugin {
  const virtualId = "virtual:quorum-content";
  const resolved = `\0${virtualId}`;
  return {
    name: "quorum-content",
    resolveId(id) {
      return id === virtualId ? resolved : null;
    },
    load(id) {
      if (id !== resolved) return null;
      const root = process.cwd();
      const configPath = path.join(root, "quorum.config.json");
      const config = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, "utf8"))
        : {};
      const reviewsDir = path.resolve(root, config.reviewsDir || "./content/reviews");
      const files = fs.existsSync(reviewsDir)
        ? fs.readdirSync(reviewsDir).filter((f) => supported.has(path.extname(f).toLowerCase())).sort((a, b) => a.localeCompare(b, undefined, { numeric: false }))
        : [];
      const reviews = files.map((file) => {
        const ext = path.extname(file).toLowerCase();
        const base = path.basename(file, ext);
        const pngSibling = `${base}.png`;
        const hasSibling = ext === ".html" && files.includes(pngSibling);
        return {
          id: base,
          filename: file,
          name: displayName(file),
          kind: ext === ".html" ? "html" : "image",
          url: `/reviews/${file}`,
          thumbnailUrl: hasSibling ? `/reviews/${pngSibling}` : ext === ".html" ? null : `/reviews/${file}`
        };
      });
      return `export const quorumContent = ${JSON.stringify({
        config,
        welcome: markdownFile(path.join(root, "content/welcome.md"), "# Welcome\n\nReview each option and leave a quick signal."),
        thankyou: markdownFile(path.join(root, "content/thankyou.md"), "# Thank you\n\nYour feedback has been recorded."),
        reviews
      })};`;
    }
  };
}

export default defineConfig({
  plugins: [react(), quorumContent()],
  publicDir: "content",
  build: {
    outDir: "dist"
  }
});
