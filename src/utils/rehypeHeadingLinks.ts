import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";

interface Options {}

/**
 * rehype插件：为标题元素添加锚点链接
 * 在构建时为所有h2-h6标题添加可点击的#链接
 */
export function rehypeHeadingLinks(_options: Options = {}) {
  return function transformer(tree: Root) {
    visit(tree, "element", (node: Element) => {
      // 匹配h2-h6标题元素
      if (["h2", "h3", "h4", "h5", "h6"].includes(node.tagName)) {
        // 添加group类名
        if (!node.properties) {
          node.properties = {};
        }

        const existingClass =
          node.properties.class || node.properties.className || [];
        const classArray = Array.isArray(existingClass)
          ? [...existingClass]
          : typeof existingClass === "string"
            ? [existingClass]
            : [];

        if (!classArray.includes("group")) {
          classArray.push("group");
        }

        node.properties.class = classArray;

        // 获取标题的id属性
        const headingId = node.properties.id as string;
        if (headingId) {
          // 创建锚点链接元素
          const linkElement: Element = {
            type: "element",
            tagName: "a",
            properties: {
              class: [
                "heading-link",
                "ms-2",
                "no-underline",
                "opacity-75",
                "md:opacity-0",
                "md:group-hover:opacity-100",
                "md:focus:opacity-100",
              ],
              href: `#${headingId}`,
            },
            children: [
              {
                type: "element",
                tagName: "span",
                properties: {
                  "aria-hidden": "true",
                },
                children: [
                  {
                    type: "text",
                    value: "#",
                  },
                ],
              },
            ],
          };

          // 将链接添加到标题的子元素中
          if (!node.children) {
            node.children = [];
          }
          node.children.push(linkElement);
        }
      }
    });
  };
}

export default rehypeHeadingLinks;
