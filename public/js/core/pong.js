export class PongGame {
  constructor(chart) {
    this.chart = chart;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pong-overlay';
    chart.renderTo.style.position = 'relative';
    chart.renderTo.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.paddleWidth = 6;
    this.leftPct = 0.03;
    this.rightPct = 0.03;
    this.ballRadius = 4;
    this.speed = 1.5;
    this.dir = 1;
    this.ballX = 0;
    this.ballY = 0;

    this.resize();
    requestAnimationFrame(() => this.loop());
  }

  resize() {
    const { plotLeft, plotTop, plotWidth, plotHeight } = this.chart;
    Object.assign(this.canvas.style, {
      left: plotLeft + 'px',
      top: plotTop + 'px'
    });
    this.canvas.width = plotWidth;
    this.canvas.height = plotHeight;
    this.ballY = plotHeight / 2;
    this.ballX = (this.leftBoundary() + this.rightBoundary()) / 2;
  }

  leftBoundary() { return this.canvas.width * 0.4048; }
  rightBoundary() { return this.canvas.width * 0.5952; }

  setPaddles(bear, bull) {
    this.leftPct = Math.max(3, +bear) / 100;
    this.rightPct = Math.max(3, +bull) / 100;
  }

  loop() {
    if (this.canvas.width !== this.chart.plotWidth ||
        this.canvas.height !== this.chart.plotHeight) {
      this.resize();
    }
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const leftX = this.leftBoundary();
    const rightX = this.rightBoundary();
    const paddleW = this.paddleWidth;
    const lH = h * this.leftPct;
    const rH = h * this.rightPct;
    const lY = (h - lH) / 2;
    const rY = (h - rH) / 2;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#ea4d5c';
    ctx.fillRect(leftX, lY, paddleW, lH);

    ctx.fillStyle = '#41e084';
    ctx.fillRect(rightX - paddleW, rY, paddleW, rH);

    this.ballX += this.dir * this.speed;
    if (this.ballX - this.ballRadius <= leftX + paddleW) {
      this.dir = 1;
      this.ballX = leftX + paddleW + this.ballRadius;
    }
    if (this.ballX + this.ballRadius >= rightX - paddleW) {
      this.dir = -1;
      this.ballX = rightX - paddleW - this.ballRadius;
    }

    ctx.fillStyle = '#999';
    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, this.ballRadius, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(() => this.loop());
  }
}
