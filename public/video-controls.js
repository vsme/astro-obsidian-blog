// 视频控制器管理脚本
(function () {
  "use strict";

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

  // DOM加载完成后初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVideoControls);
  } else {
    initVideoControls();
  }

  // 监听动态添加的视频元素
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === "VIDEO") {
            initVideoControls();
          } else if (node.querySelector && node.querySelector("video")) {
            initVideoControls();
          }
        }
      });
    });
  });

  // 确保document.body存在后再开始观察
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
})();
