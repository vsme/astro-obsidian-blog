import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import * as esbuild from "esbuild";

export function compressPublicJS() {
  return {
    name: "compress-public-js",
    async writeBundle(options: { dir?: string }) {
      const outDir = options.dir || "dist";
      const publicDir = join(outDir);

      try {
        await compressJSFiles(publicDir);
      } catch (error) {
        console.warn("压缩 public JS 文件时出错:", error);
      }
    },
  };
}

async function compressJSFiles(dir: string) {
  try {
    const files = readdirSync(dir);

    for (const file of files) {
      const filePath = join(dir, file);
      const stat = statSync(filePath);

      if (stat.isDirectory()) {
        await compressJSFiles(filePath);
      } else if (file.endsWith(".js")) {
        await compressJSFile(filePath);
      }
    }
  } catch (error) {
    console.warn(`读取目录 ${dir} 时出错:`, error);
  }
}

async function compressJSFile(filePath: string) {
  try {
    const content = readFileSync(filePath, "utf-8");
    let compressedContent: string;

    // 只处理 public 目录下的 JS 文件，跳过 _astro 和 pagefind 目录
    if (filePath.includes("_astro") || filePath.includes("pagefind")) {
      return;
    }

    try {
      const result = await esbuild.transform(content, {
        minify: true,
        target: "es2018",
        format: "iife",
      });
      compressedContent = result.code;
      console.log(`使用 esbuild 压缩: ${filePath}`);
    } catch (esbuildError) {
      console.warn(`esbuild 压缩失败: ${filePath}`, esbuildError);
      compressedContent = content;
    }

    writeFileSync(filePath, compressedContent, "utf-8");
  } catch (error) {
    console.warn(`压缩文件 ${filePath} 时出错:`, error);
  }
}
