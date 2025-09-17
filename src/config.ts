export const SITE = {
  website: "https://bgo.me/", // replace this with your deployed domain
  author: "Yawei Sun",
  profile: "https://bgo.me/",
  desc: "一个时间长河中的个人档案馆。",
  title: "Bingo!",
  ogImage: "og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 5,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true, // show back button in post detail
  editPost: {
    enabled: false,
    text: "Edit page",
    url: "https://github.com/vsme/obsidian-blog-data",
  },
  comments: {
    enabled: true, // 启用评论功能
  },
  dynamicOgImage: false,
  dir: "ltr", // "rtl" | "auto"
  lang: "zh-CN", // html lang code. Set this empty and default will be "en"
  timezone: "Asia/Shanghai", // Default global timezone (IANA format) https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
} as const;
