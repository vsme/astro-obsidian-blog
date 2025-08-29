import { visit } from "unist-util-visit";
import type { Root, Code } from "mdast";
import type { Node } from "unist";
import type {
  MediaCardData,
  MediaCardOptions,
  MediaCardType,
} from "../types/media";
import { renderToString } from "react-dom/server";
import MediaCard from "../components/MediaCard";
import React from "react";

// 定义基本的Node类型
interface Parent extends Node {
  children: Node[];
}

// HTML 节点接口
interface HtmlNode extends Node {
  type: "html";
  value: string;
}

/**
 * 解析卡片内容的通用函数
 */
function parseCardContent(content: string): MediaCardData | null {
  const lines = content
    .trim()
    .split("\n")
    .filter(line => line.trim());
  const data: Record<string, string | number> = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();

    if (!key || !value) continue;

    // 尝试转换数字类型
    if (/^\d+(\.\d+)?$/.test(value)) {
      data[key] = parseFloat(value);
    } else {
      data[key] = value;
    }
  }

  // 检查是否有必需的 title 字段
  if (!data.title || typeof data.title !== "string") {
    return null;
  }

  // 先转换为 unknown 类型，再转换为 MediaCardData 类型，以确保类型安全
  return data as unknown as MediaCardData;
}

/**
 * 创建媒体卡片 HTML
 */
function createMediaCardHtml(
  cardType: MediaCardType,
  mediaData: MediaCardData
): string {
  // 使用 renderToString 将 React 组件渲染为 HTML 字符串
  const htmlString = renderToString(
    React.createElement(MediaCard, {
      mediaData,
      cardType,
    })
  );

  return `${htmlString}`;
}

/**
 * Remark 插件：转换媒体卡片代码块为 HTML div 元素
 */
export function remarkMediaCard(options: MediaCardOptions = {}) {
  const { enableDebug = false } = options;

  return function transformer(tree: Root) {
    // 两阶段处理：首先收集所有需要处理的节点
    const nodesToProcess: Array<{
      node: Code;
      index: number;
      parent: Parent;
      cardType: MediaCardType;
      mediaData: MediaCardData;
    }> = [];

    // 第一阶段：收集符合条件的节点
    visit(tree, "code", (node: Code, index?: number, parent?: Parent) => {
      if (!parent || index === undefined || !parent.children) {
        return;
      }

      // 检查是否是媒体卡片代码块
      const cardTypeMatch = node.lang?.match(/^card-(movie|tv|book|music)$/);
      if (!cardTypeMatch) {
        return;
      }

      const cardType = cardTypeMatch[1];
      const mediaData = parseCardContent(node.value);

      if (!mediaData) {
        if (enableDebug) {
          console.warn(
            `Failed to parse media data for ${cardType} card:`,
            node.value
          );
        }
        return;
      }

      if (enableDebug) {
        console.log(`Found ${cardType} card:`, mediaData.title);
      }

      nodesToProcess.push({
        node,
        index,
        parent,
        cardType: cardType as MediaCardType,
        mediaData,
      });
    });

    // 第二阶段：处理收集到的节点（从后往前处理以避免索引问题）
    for (let i = nodesToProcess.length - 1; i >= 0; i--) {
      const { index, parent, cardType, mediaData } = nodesToProcess[i];

      try {
        // 创建 HTML 节点
        const htmlNode: HtmlNode = {
          type: "html",
          value: createMediaCardHtml(cardType, mediaData),
        };

        // 替换原始代码块节点
        parent.children[index] = htmlNode;

        if (enableDebug) {
          console.log(
            `Replaced ${cardType} card with HTML node:`,
            mediaData.title
          );
        }
      } catch (error) {
        if (enableDebug) {
          console.error(`Error processing ${cardType} card:`, error);
        }
      }
    }
  };
}

export default remarkMediaCard;
