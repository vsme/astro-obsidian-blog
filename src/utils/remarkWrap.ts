import { visit } from "unist-util-visit";
import type { Node } from "unist";

// 定义基本的Node类型
interface Parent extends Node {
  children: Node[];
}

interface Options {
  className?: string;
}

/**
 * 简易版 remark wrap 插件
 * 根据 CSS 选择器匹配元素并包装在指定的容器中
 */
export function remarkWrap(options: Options = {}) {
  const { className = "" } = options;

  return function transformer(tree: Node) {
    // 处理 TOC 特殊情况 - 查找所有包含内部链接的列表并包裹第一个
    const nodesToProcess: Array<{ node: Node; index: number; parent: Parent }> =
      [];

    // 首先收集所有符合条件的节点
    visit(tree, (node: Node, index?: number, parent?: Parent) => {
      if (!parent || index === undefined || !parent.children) return;

      // 查找列表节点
      if (node.type === "list") {
        const listNode = node as Parent;

        // 检查是否包含内部链接（以#开头的链接）
        const hasInternalLinks = listNode.children?.some((child: Node) => {
          const listItem = child as Parent;
          if (child.type !== "listItem" || !listItem.children) return false;

          return listItem.children.some((grandChild: Node) => {
            const paragraph = grandChild as Parent;
            if (grandChild.type !== "paragraph" || !paragraph.children)
              return false;

            return paragraph.children.some((link: Node) => {
              if (link.type !== "link") return false;
              const linkNode = link as { url?: string };
              return linkNode.url?.startsWith("#");
            });
          });
        });

        if (hasInternalLinks) {
          nodesToProcess.push({ node, index, parent });
        }
      }
    });

    // 只处理第一个找到的TOC列表
    if (nodesToProcess.length > 0) {
      const { node, index, parent } = nodesToProcess[0];

      // 创建包装容器
      const wrapperNode = {
        type: "html",
        value: `<div class="${className}">`,
      };
      const closingNode = {
        type: "html",
        value: "</div>",
      };

      // 替换目标节点为包装后的节点
      parent.children.splice(index, 1, wrapperNode, node, closingNode);
    }
  };
}

export default remarkWrap;
