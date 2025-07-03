function drawMedia(canvas, video) {
  const offCtx = canvas.getContext("2d");
  // draw to the offscreen canvas context
  offCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // requestAnimationFrame 根据电脑显示帧数进行循环
  animationFrame = requestAnimationFrame(() => drawMedia(canvas, video));
}

self.addEventListener("message", (message) => {
  console.log(message);
  const { canvas } = message.data;
});
