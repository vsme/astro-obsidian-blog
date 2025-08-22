import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

interface Props {
  image: {
    src: string;
    width: number;
    height: number;
    format: string;
  };
}

interface CachedImageDataType {
  imageData: ImageData;
  width: number;
  height: number;
  context: CanvasRenderingContext2D;
}

const DisintegrationImg: React.FC<Props> = ({ image }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const hasPlayedAnimationRef = useRef(false);

  // 使用 useRef 来存储这些变量，避免重新渲染时丢失
  const animationState = useRef({
    originalImgParent: null as HTMLElement | null,
    originalImgNextSibling: null as ChildNode | null,
    isAnimating: false,
    fragmentPool: [] as {
      canvas: HTMLCanvasElement;
      context: CanvasRenderingContext2D;
    }[],
    cachedImageData: null as CachedImageDataType | null,
  });

  const preprocessImageData = () => {
    const img = imgRef.current;
    if (!img || animationState.current.cachedImageData) return;

    // 创建隐藏画布获取像素数据
    const hidden = document.createElement("canvas");
    const W = (hidden.width = img.width);
    const H = (hidden.height = Math.round(
      (W / img.naturalWidth) * img.naturalHeight
    ));
    const hctx = hidden.getContext("2d", {
      alpha: false,
    }) as CanvasRenderingContext2D; // 禁用alpha通道提升性能
    hctx.drawImage(img, 0, 0, W, H);

    animationState.current.cachedImageData = {
      imageData: hctx.getImageData(0, 0, W, H),
      width: W,
      height: H,
      context: hctx,
    };
  };

  const createFragmentPool = (count: number) => {
    const { fragmentPool } = animationState.current;
    // 重用canvas元素池
    while (fragmentPool.length < count) {
      const fragCanvas = document.createElement("canvas");
      fragCanvas.className = "fragment-canvas";
      fragmentPool.push({
        canvas: fragCanvas,
        context: fragCanvas.getContext("2d", {
          alpha: true,
        }) as CanvasRenderingContext2D,
      });
    }
    return fragmentPool.slice(0, count);
  };

  const createAggregationEffect = () => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || animationState.current.isAnimating) return;

    animationState.current.isAnimating = true;

    // 隐藏原始图片
    img.style.opacity = "0";

    const {
      imageData,
      width: W,
      height: H,
    } = animationState.current.cachedImageData!;
    const COUNT = 40; // 减少片段数量提升性能
    const REPEAT_COUNT = 1; // 减少重复次数

    // 使用对象池
    const fragments = createFragmentPool(COUNT);
    const dataList = [];

    // 预分配ImageData对象
    for (let i = 0; i < COUNT; i++) {
      dataList.push(new ImageData(W, H));
    }

    // 优化像素分配算法
    const pixelData = imageData.data;
    const totalPixels = W * H;

    // 使用更高效的像素分配
    for (let i = 0; i < totalPixels; i++) {
      const x = i % W;
      // const y = Math.floor(i / W);
      const pixelIndex = i * 4;

      for (let l = 0; l < REPEAT_COUNT; l++) {
        const dataIndex = Math.floor(
          (COUNT * (Math.random() + (2 * x) / W)) / 3
        );
        if (dataIndex < COUNT && dataIndex >= 0) {
          const targetData = dataList[dataIndex].data;
          targetData[pixelIndex] = pixelData[pixelIndex]; // R
          targetData[pixelIndex + 1] = pixelData[pixelIndex + 1]; // G
          targetData[pixelIndex + 2] = pixelData[pixelIndex + 2]; // B
          targetData[pixelIndex + 3] = pixelData[pixelIndex + 3]; // A
        }
      }
    }

    // 创建 GSAP 时间轴用于片段动画
    const fragmentTimeline = gsap.timeline();
    const activeFragments: HTMLCanvasElement[] = [];

    // 批量创建和设置片段
    const fragment = document.createDocumentFragment();

    dataList.forEach((data, i) => {
      const { canvas: fragCanvas, context: fragCtx } = fragments[i];

      // 设置canvas尺寸
      fragCanvas.width = W;
      fragCanvas.height = H;
      fragCtx.putImageData(data, 0, 0);

      // 批量设置样式
      Object.assign(fragCanvas.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        borderRadius: "var(--radius-md)",
        width: (img.style.width || img.width) + "px",
        height: (img.style.height || img.height) + "px",
        zIndex: "5",
      });

      // 预计算随机值
      const randomAngle = (Math.random() - 0.5) * 2 * Math.PI;
      const randomRotationAngle = 30 * (Math.random() - 0.5);
      const startX = 40 * Math.sin(randomAngle);
      const startY = 40 * Math.cos(randomAngle);

      fragment.appendChild(fragCanvas);
      activeFragments.push(fragCanvas);

      // 计算延迟 - 从左到右依次聚合
      const delay = (i / dataList.length) * 1;

      // 使用 GSAP 创建聚合动画，启用GPU加速
      fragmentTimeline.fromTo(
        fragCanvas,
        {
          x: startX,
          y: startY,
          rotation: randomRotationAngle,
          opacity: 0,
          scale: 0.8,
          force3D: true, // 强制GPU加速
        },
        {
          x: 0,
          y: 0,
          rotation: 0,
          opacity: 1,
          scale: 1,
          duration: 0.8, // 减少动画时长
          ease: "back.out(1.7)",
          force3D: true,
        },
        delay
      );
    });

    // 一次性添加所有片段到DOM
    container.appendChild(fragment);

    // 主时间轴控制整个流程
    const masterTimeline = gsap.timeline({
      onComplete: () => {
        // 清理所有片段
        activeFragments.forEach(fragment => {
          if (fragment.parentNode) {
            fragment.parentNode.removeChild(fragment);
          }
        });

        animationState.current.isAnimating = false;
      },
    });

    // 在动画完成前1秒显示原始图片
    masterTimeline
      .to({}, { duration: 3 })
      .to(img, { opacity: 1, duration: 1 }, "-=1")
      .call(() => {
        // 确保添加loaded类，使用CSS过渡效果
        img.classList.add("loaded");
        setIsLoaded(true);
        hasPlayedAnimationRef.current = true;
      });
  };

  const startEffect = () => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    // 记录原始位置信息
    animationState.current.originalImgParent = img.parentNode as HTMLElement;
    animationState.current.originalImgNextSibling =
      img.nextSibling as ChildNode;

    // 预处理图片数据
    preprocessImageData();

    // 开始聚合效果
    createAggregationEffect();
  };

  const handleImageLoad = () => {
    // 只在首次加载时播放动画
    if (!hasPlayedAnimationRef.current) {
      startEffect();
    } else {
      // 如果已经播放过动画，直接显示图片
      const img = imgRef.current;
      if (img) {
        img.classList.add("loaded");
        setIsLoaded(true);
      }
    }
  };

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    // 等待图片加载完成
    if (img.complete) {
      handleImageLoad();
    } else {
      img.addEventListener("load", handleImageLoad);
    }

    return () => {
      img.removeEventListener("load", handleImageLoad);
    };
  }, [image.src]);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ aspectRatio: `${image.width}/${image.height}` }}
    >
      <img
        ref={imgRef}
        src={image.src}
        crossOrigin="anonymous"
        className={`disintegration-img ${isLoaded ? "loaded" : ""}`}
        alt=""
      />
    </div>
  );
};

export default DisintegrationImg;
