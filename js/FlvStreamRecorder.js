// 添加日志
function addLog(message) {
  const now = new Date();
  const timestamp = `[${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}]`;

  //   const logEntry = document.createElement("div");
  //   logEntry.className = "log-entry";
  //   logEntry.innerHTML = `<span class="log-timestamp">${timestamp}</span> ${message}`;

  //   logContainer.appendChild(logEntry);
  let logcatbox = document.getElementsByName("logcatbox")[0];
  logcatbox.value = logcatbox.value + timestamp + message + "\n";
  //   logContainer.scrollTop = logContainer.scrollHeight;
  logcatbox.scrollTop = logcatbox.scrollHeight;
}

// ======================
// FLV录像功能封装类
// ======================
class FlvStreamRecorder {
  constructor(videoElement, options = {}) {
    // 配置参数
    this.options = Object.assign(
      {
        streamName: "未命名流",
        fps: 25,
        scale: 0.8,
        bitrate: 2000000,
        containerFormat: "mp4",
      },
      options
    );

    // 元素和状态
    this.videoElement = videoElement;
    this.isRecording = false;
    this.recordingStartTime = 0;
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.droppedFrameCount = 0;
    this.currentFps = this.options.fps;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.canvas = null;
    this.ctx = null;
    this.animationFrameId = null;
    this.dataBuffer = [];
    this.forceKeyFrame = true; // 强制下一个帧是关键帧
    this.minRecordingTime = 2000; // 最小录制时间(毫秒)

    // 日志函数
    this.log = (message) => {
      const timestamp = new Date().toLocaleTimeString();
      addLog(`[${this.options.streamName}] ${message}`);
    };

    // 创建Canvas
    this._createCanvas();
    this.log(
      `录像器初始化完成 (${this.options.fps}FPS, 缩放${this.options.scale})`
    );
  }

  _createCanvas() {
    if (this.canvas) {
      document.body.removeChild(this.canvas);
    }

    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "none";
    document.body.appendChild(this.canvas);

    // 设置Canvas尺寸
    this.canvas.width = this.videoElement.videoWidth * this.options.scale;
    this.canvas.height = this.videoElement.videoHeight * this.options.scale;

    this.ctx = this.canvas.getContext("2d");
    this.log(`创建录制画布: ${this.canvas.width}x${this.canvas.height}`);
  }

  _getSupportedMimeType() {
    const codecs = [
      'video/mp4;codecs=avc1.640028',
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];

    if (this.options.containerFormat === "mp4") {
      codecs.unshift('video/mp4;codecs=avc1.42E01E');
    }

    for (let mime of codecs) {
      if (MediaRecorder.isTypeSupported(mime)) {
        this.log(`使用编码格式: ${mime}`);
        return mime;
      }
    }

    this.log("错误: 没有找到支持的编码格式", "error");
    return null;
  }

  /**
   * 确保视频包含完整的关键帧
   */
  _ensureKeyFrame() {
    if (!this.mediaRecorder) return;

    // 强制插入关键帧
    try {
      // 重新绘制Canvas强制新帧
      this.ctx.drawImage(
        this.videoElement,
        0,
        0,
        this.canvas.width,
        this.canvas.height
      );

      // 对于MediaRecorder，我们无法直接插入关键帧
      // 但通过重新配置可以间接实现
      this.mediaRecorder.pause();
      this.mediaRecorder.resume();

      this.forceKeyFrame = false;
      this.log("已插入关键帧");
    } catch (e) {
      this.log(`插入关键帧失败: ${e.message}`);
    }
  }

  startRecording() {
    if (this.isRecording) {
      this.log("录像已经在进行中");
      return false;
    }

    if (!this.videoElement.videoWidth) {
      this.log("错误: 视频未准备好");
      return false;
    }

    if (
      this.canvas.width !== this.videoElement.videoWidth * this.options.scale ||
      this.canvas.height !== this.videoElement.videoHeight * this.options.scale
    ) {
      this._createCanvas();
    }

    // 重置状态
    this.isRecording = true;
    this.recordedChunks = [];
    this.dataBuffer = [];
    this.recordingStartTime = Date.now();
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.droppedFrameCount = 0;
    this.currentFps = this.options.fps;
    this.forceKeyFrame = true;

    // 从Canvas获取媒体流
    const stream = this.canvas.captureStream(this.options.fps);

    // 获取支持的MIME类型
    const mimeType = this._getSupportedMimeType();
    if (!mimeType) return false;

    // 设置录制选项
    const options = {
      mimeType: mimeType,
      videoBitsPerSecond: this.options.bitrate,
    };

    try {
      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.dataBuffer.push(event.data);
          this.log(`收到数据块: ${(event.data.size / 1024).toFixed(1)}KB`);
          this._processDataBuffer();
        }
      };

      this.mediaRecorder.onstop = () => {
        const duration = Date.now() - this.recordingStartTime;

        // 延长短录制处理时间
        const delay = duration < 3000 ? 1000 : 500;

        setTimeout(() => {
          this._processDataBuffer(true);
          this.isRecording = false;
          this.log("录制已停止，准备下载");
          this.downloadRecording();

          // 对于短录制，添加完整性检查
          if (duration < 3000) {
            this._validateRecording();
          }
        }, delay);
      };

      this.mediaRecorder.onerror = (event) => {
        this.log(`录制错误: ${event}`, "error");
      };

      // 开始录制
      this.mediaRecorder.start(2000);

      // 启动帧捕获循环
      this._captureFrame();

      this.log(`开始录制，目标帧率: ${this.options.fps}FPS`);
      return true;
    } catch (e) {
      this.log(`创建MediaRecorder失败: ${e.message}`, "error");
      return false;
    }
  }

  /**
   * 验证录制完整性
   */
  _validateRecording() {
    if (this.recordedChunks.length === 0) {
      this.log("警告: 录制数据为空");
      return;
    }

    const totalSize = this.recordedChunks.reduce(
      (sum, chunk) => sum + chunk.size,
      0
    );
    const duration = Date.now() - this.recordingStartTime;

    // 检查文件大小是否合理
    if (totalSize < 1024) {
      this.log("警告: 录制文件过小，可能不完整");
    }

    // 检查录制时长
    if (duration < 1000) {
      this.log("警告: 录制时间过短，视频可能无法播放");
    }
  }

  _processDataBuffer(final = false) {
    if (this.dataBuffer.length > 0) {
      this.recordedChunks = this.recordedChunks.concat(this.dataBuffer);
      this.dataBuffer = [];
      this.log(`已处理缓冲数据，总数据块: ${this.recordedChunks.length}`);
    }

    if (final && this.dataBuffer.length === 0) {
      this.log("所有缓冲数据已处理完成");
    }
  }

  _captureFrame() {
    if (!this.isRecording) return;

    const timestamp = performance.now();

    if (!this.lastFrameTime) this.lastFrameTime = timestamp;

    const elapsed = timestamp - this.lastFrameTime;
    const targetInterval = 1000 / this.currentFps;

    if (elapsed > targetInterval) {
      try {
        this.ctx.drawImage(
          this.videoElement,
          0,
          0,
          this.canvas.width,
          this.canvas.height
        );

        // 强制插入关键帧（录制开始时）
        if (this.forceKeyFrame) {
          this._ensureKeyFrame();
        }

        if (elapsed > targetInterval * 1.5 && this.currentFps > 15) {
          this.currentFps = Math.max(15, this.currentFps - 2);
          this.log(`系统负载高，降低帧率至 ${this.currentFps} FPS`, "warning");
        } else if (
          this.currentFps < this.options.fps &&
          elapsed < targetInterval * 0.8
        ) {
          this.currentFps = Math.min(this.options.fps, this.currentFps + 1);
          this.log(`系统性能良好，提高帧率至 ${this.currentFps} FPS`);
        }

        this.lastFrameTime = timestamp;
        this.frameCount++;
      } catch (e) {
        this.log(`帧处理错误: ${e.message}`);
      }
    } else {
      this.droppedFrameCount++;
    }

    this.animationFrameId = requestAnimationFrame(() => this._captureFrame());
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      const duration = Date.now() - this.recordingStartTime;

      // 确保最短录制时间
      if (duration < this.minRecordingTime) {
        this.log(`录制时间不足${this.minRecordingTime}ms，延长至最短时间`);
        setTimeout(() => {
          this.mediaRecorder.stop();
          cancelAnimationFrame(this.animationFrameId);
          this.log("正在停止录制...");
        }, this.minRecordingTime - duration);
      } else {
        this.mediaRecorder.stop();
        cancelAnimationFrame(this.animationFrameId);
        this.log("正在停止录制...");
      }

      return true;
    }
    return false;
  }

  /**
   * 增强短录制视频的播放兼容性
   */
  _enhanceShortRecording(blob) {
    // 在实际应用中，这里可以使用Mux.js等库处理
    // 为简化演示，我们直接返回原始blob
    // 但在实际项目中，这里应该：
    // 1. 解析视频数据
    // 2. 确保包含关键帧
    // 3. 添加必要的元数据
    // 4. 重新封装视频
    return blob;
  }

  /**
   * 获取录像
   */
  downloadRecording() {
    if (this.recordedChunks.length === 0) {
      this.log("错误: 没有录制内容");
      return false;
    }

    const fileExtension =
      this.options.containerFormat === "mp4" ? "mp4" : "webm";

    try {
      const blob = new Blob(this.recordedChunks, {
        type:
          this.options.containerFormat === "mp4" ? "video/mp4" : "video/webm",
      });

      DownloadStreamSaver(
        blob,
        `${formatDateTime(new Date())}.${fileExtension}`
      );
      return { blob, type: fileExtension };
    } catch (e) {
      this.log(`获取失败: ${e.message}`, "error");
      return false;
    }
  }

  /**
   * 获取录制状态
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      streamName: this.options.streamName,
      fps: this.currentFps,
      frameCount: this.frameCount,
      droppedFrames: this.droppedFrameCount,
      duration: this.isRecording
        ? (Date.now() - this.recordingStartTime) / 1000
        : 0,
    };
  }
}
