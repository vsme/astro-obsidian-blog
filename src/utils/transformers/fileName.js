/**
 * 自定义 Shiki 转换器，用于在代码块中添加文件名标签。
 *
 * 该转换器会查找代码块中的 `file="filename"` meta 属性，
 * 并创建一个显示文件名的样式标签。支持两种不同的样式选项，
 * 并可以选择性地隐藏绿点指示器。
 *
 * @param {Object} options - 转换器的配置选项
 * @param {string} [options.style="v2"] - 要使用的样式变体
 *   - `"v1"`: 标签页样式，带圆角顶部，位于左上角
 *   - `"v2"`: 徽章样式，带边框，位于左上角并带偏移
 * @param {boolean} [options.hideDot=false] - 是否隐藏绿点指示器
 */
export const transformerFileName = ({
  style = "v2",
  hideDot = false,
} = {}) => ({
  pre(node) {
    // Add CSS custom property to the node
    const fileNameOffset = style === "v1" ? "0.75rem" : "-0.75rem";
    node.properties.style =
      (node.properties.style || "") + `--file-name-offset: ${fileNameOffset};`;

    const raw = this.options.meta?.__raw?.split(" ");

    if (!raw) return;

    const metaMap = new Map();

    for (const item of raw) {
      const [key, value] = item.split("=");
      if (!key || !value) continue;
      metaMap.set(key, value.replace(/["'`]/g, ""));
    }

    const file = metaMap.get("file");

    if (!file) return;

    // Add additional margin to code block
    this.addClassToHast(
      node,
      `mt-8 ${style === "v1" ? "rounded-tl-none" : ""}`
    );

    // Add file name to code block
    node.children.push({
      type: "element",
      tagName: "span",
      properties: {
        class: [
          "absolute py-1 text-foreground text-xs font-medium leading-4",
          hideDot
            ? "px-2"
            : "pl-4 pr-2 before:inline-block before:size-1 before:bg-green-500 before:rounded-full before:absolute before:top-[45%] before:left-2",
          style === "v1"
            ? "left-0 -top-6 rounded-t-md border border-b-0 bg-muted/50"
            : "left-2 top-(--file-name-offset) border rounded-md bg-background",
        ],
      },
      children: [
        {
          type: "text",
          value: file,
        },
      ],
    });
  },
});
