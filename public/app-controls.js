// 应用控制器管理脚本 - 主题切换和视频控制
(function () {
  "use strict";

  // ===== 主题切换功能 =====
  const primaryColorScheme = ""; // "light" | "dark"

  // Get theme data from local storage
  const currentTheme = localStorage.getItem("theme");

  function getPreferTheme() {
    // return theme value in local storage if it is set
    if (currentTheme) return currentTheme;

    // return primary color scheme if it is set
    if (primaryColorScheme) return primaryColorScheme;

    // return user device's prefer color scheme
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  let themeValue = getPreferTheme();

  function setPreference() {
    localStorage.setItem("theme", themeValue);
    reflectPreference();
  }

  function reflectPreference() {
    document.firstElementChild.setAttribute("data-theme", themeValue);

    document
      .querySelector("#theme-btn")
      ?.setAttribute("aria-label", themeValue);
    document
      .querySelector("#theme-btn-mobile")
      ?.setAttribute("aria-label", themeValue);

    // Get a reference to the body element
    const body = document.body;

    // Check if the body element exists before using getComputedStyle
    if (body) {
      // Get the computed styles for the body element
      const computedStyles = window.getComputedStyle(body);

      // Get the background color property
      const bgColor = computedStyles.backgroundColor;

      // Set the background color in <meta theme-color ... />
      document
        .querySelector("meta[name='theme-color']")
        ?.setAttribute("content", bgColor);
    }
  }

  // set early so no page flashes / CSS is made aware
  reflectPreference();

  function initThemeControls() {
    function setThemeFeature() {
      // set on load so screen readers can get the latest value on the button
      reflectPreference();

      // Helper function to add theme toggle functionality
      function addThemeToggle(selector) {
        const btn = document.querySelector(selector);
        if (btn) {
          // Add cursor pointer style for iOS Safari compatibility
          btn.style.cursor = "pointer";

          const toggleTheme = () => {
            themeValue = themeValue === "light" ? "dark" : "light";
            setPreference();
          };

          // Add click event listener
          btn.addEventListener("click", toggleTheme);

          // Add touchend event listener for iOS Safari compatibility
          btn.addEventListener("touchend", e => {
            e.preventDefault();
            toggleTheme();
          });
        }
      }

      // Add theme toggle functionality to both buttons
      addThemeToggle("#theme-btn");
      addThemeToggle("#theme-btn-mobile");
    }

    setThemeFeature();

    // Runs on view transitions navigation
    document.addEventListener("astro:after-swap", setThemeFeature);
  }

  // Set theme-color value before page transition
  // to avoid navigation bar color flickering in Android dark mode
  document.addEventListener("astro:before-swap", event => {
    const bgColor = document
      .querySelector("meta[name='theme-color']")
      ?.getAttribute("content");

    event.newDocument
      .querySelector("meta[name='theme-color']")
      ?.setAttribute("content", bgColor);
  });

  // sync with system changes
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", ({ matches: isDark }) => {
      themeValue = isDark ? "dark" : "light";
      setPreference();
    });

  // ===== 视频控制功能 =====

  // 初始化所有视频元素
  function initVideoControls() {
    const videos = document.querySelectorAll("video");

    videos.forEach(video => {
      setupVideoControls(video);
    });
  }

  function setupVideoControls(video) {
    // 创建视频容器和播放按钮
    createVideoContainer(video);
    const playButton = createPlayButton(video);
    let hideControlsTimer = null;

    // 初始状态：隐藏控制器，显示播放按钮
    video.classList.add("video-controls-hidden");

    // 显示控制器的函数
    function showControls() {
      if (!video.paused) {
        video.classList.remove("video-controls-hidden");
        video.classList.add("video-controls-visible");
      }
    }

    // 隐藏控制器的函数
    function hideControls() {
      video.classList.remove("video-controls-visible");
      video.classList.add("video-controls-hidden");
      // 只有在视频暂停时才显示播放按钮
      if (video.paused) {
        playButton.classList.remove("hidden");
      } else {
        // 视频播放时确保播放按钮保持隐藏
        playButton.classList.add("hidden");
      }
    }

    // 重置定时器的函数
    function resetHideTimer() {
      if (hideControlsTimer) {
        clearTimeout(hideControlsTimer);
      }
      if (!video.paused) {
        hideControlsTimer = setTimeout(() => {
          hideControls();
        }, 2000); // 2秒后自动隐藏
      }
    }

    // 播放时显示控制器，隐藏播放按钮
    video.addEventListener("play", () => {
      showControls();
      playButton.classList.add("hidden");
      resetHideTimer();
    });

    // 暂停时隐藏控制器，显示播放按钮
    video.addEventListener("pause", () => {
      if (hideControlsTimer) {
        clearTimeout(hideControlsTimer);
      }
      hideControls();
      playButton.classList.remove("hidden");
    });

    // 鼠标悬停时显示控制器
    video.addEventListener("mouseenter", () => {
      showControls();
      resetHideTimer();
    });

    // 鼠标移动时重置定时器
    video.addEventListener("mousemove", () => {
      showControls();
      resetHideTimer();
    });

    // 鼠标离开时隐藏控制器
    video.addEventListener("mouseleave", () => {
      if (hideControlsTimer) {
        clearTimeout(hideControlsTimer);
      }
      hideControls();
    });

    // 视频结束时隐藏控制器，显示播放按钮
    video.addEventListener("ended", () => {
      if (hideControlsTimer) {
        clearTimeout(hideControlsTimer);
      }
      hideControls();
      playButton.classList.remove("hidden");
    });
  }

  function createVideoContainer(video) {
    // 检查是否已经有容器
    if (
      video.parentElement &&
      video.parentElement.classList.contains("video-container")
    ) {
      return video.parentElement;
    }

    // 创建容器
    const container = document.createElement("div");
    container.className = "video-container";

    // 将视频包装在容器中
    video.parentNode.insertBefore(container, video);
    container.appendChild(video);

    return container;
  }

  function createPlayButton(video) {
    const container = video.parentElement;

    // 检查是否已经有播放按钮
    let playButton = container.querySelector(".video-play-button");
    if (playButton) {
      return playButton;
    }

    // 创建播放按钮
    playButton = document.createElement("button");
    playButton.className = "video-play-button";
    playButton.setAttribute("aria-label", "播放视频");

    // 点击播放按钮时播放视频
    playButton.addEventListener("click", () => {
      video.play();
    });

    // 将播放按钮添加到容器中
    container.appendChild(playButton);

    return playButton;
  }

  // 监听动态添加的视频元素
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === "VIDEO") {
            setupVideoControls(node);
          } else if (node.querySelector && node.querySelector("video")) {
            const videos = node.querySelectorAll("video");
            videos.forEach(video => {
              setupVideoControls(video);
            });
          }
        }
      });
    });
  });

  // 确保document.body存在后再开始观察
  function initVideoObserver() {
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } else {
      // 如果body还没有加载，等待DOMContentLoaded事件
      document.addEventListener("DOMContentLoaded", () => {
        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
          });
        }
      });
    }
  }

  // ===== 初始化所有功能 =====

  // 页面加载完成后初始化
  window.onload = () => {
    initThemeControls();
  };

  // 监听Astro页面导航事件，重新初始化所有控制器
  document.addEventListener("astro:page-load", () => {
    initVideoControls();
    initVideoObserver();
  });
})();
