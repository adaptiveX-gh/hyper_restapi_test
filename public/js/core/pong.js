export function vFromSigma(sigmaBps) {
  return 0.3 + Math.min(3, sigmaBps) / 3 * 0.9;
}

export function chase(paddle, ballY, obi) {
  const chaseSpeed = Math.abs(obi - 1) * 1.5;
  if (ballY > paddle.y) paddle.y += Math.min(chaseSpeed, 2);
  else                   paddle.y -= Math.min(chaseSpeed, 2);
}

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

    this.leftY = 0;
    this.rightY = 0;
    this.vx = this.speed;
    this.vy = 0;

    this.obi = 1;
    this.bull = 0;
    this.bear = 0;
    this.midPrice = 0;

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
    this.leftY = plotHeight / 2;
    this.rightY = plotHeight / 2;
  }

  leftBoundary() { return this.canvas.width * 0.4048; }
  rightBoundary() { return this.canvas.width * 0.5952; }

  update({ bearPct, bullPct, obi, sigmaBps, midPrice }) {
    if (bearPct != null) {
      this.leftPct = Math.max(3, +bearPct) / 100;
      this.bear = bearPct;
    }
    if (bullPct != null) {
      this.rightPct = Math.max(3, +bullPct) / 100;
      this.bull = bullPct;
    }
    if (obi != null) this.obi = obi;
    if (sigmaBps != null) {
      this.sigma = sigmaBps;
      this.speed = vFromSigma(sigmaBps);
      this.vx = Math.sign(this.vx || 1) * this.speed;
    }
    if (midPrice != null) this.midPrice = midPrice;
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

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#ea4d5c';
    ctx.fillRect(leftX, this.leftY - lH / 2, paddleW, lH);

    ctx.fillStyle = '#41e084';
    ctx.fillRect(rightX - paddleW, this.rightY - rH / 2, paddleW, rH);

    const lp = { y: this.leftY };
    const rp = { y: this.rightY };
    chase(lp, this.ballY, this.obi);
    chase(rp, this.ballY, this.obi);
    this.leftY = Math.max(lH / 2, Math.min(h - lH / 2, lp.y));
    this.rightY = Math.max(rH / 2, Math.min(h - rH / 2, rp.y));

    this.ballX += this.vx;
    this.ballY += this.vy;

    if (this.ballY - this.ballRadius <= 0 || this.ballY + this.ballRadius >= h) {
      this.vy *= -1;
      this.ballY = Math.max(this.ballRadius, Math.min(h - this.ballRadius, this.ballY));
    }

    if (this.ballX - this.ballRadius <= leftX + paddleW) {
      if (this.ballY >= this.leftY - lH / 2 && this.ballY <= this.leftY + lH / 2) {
        this.vx = Math.abs(this.vx);
        this.ballX = leftX + paddleW + this.ballRadius;
      } else if (this.ballX < leftX) {
        this.registerMiss('left');
        return;
      }
    }
    if (this.ballX + this.ballRadius >= rightX - paddleW) {
      if (this.ballY >= this.rightY - rH / 2 && this.ballY <= this.rightY + rH / 2) {
        this.vx = -Math.abs(this.vx);
        this.ballX = rightX - paddleW - this.ballRadius;
      } else if (this.ballX > rightX) {
        this.registerMiss('right');
        return;
      }
    }

    ctx.fillStyle = '#999';
    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, this.ballRadius, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(() => this.loop());
  }

  registerMiss(side) {
    const dir = side === 'left' ? 'LONG' : 'SHORT';
    const allow = (dir === 'LONG' && this.bull > 45) ||
                  (dir === 'SHORT' && this.bear > 45);
    if (allow && this.midPrice) {
      const entry = {
        dir,
        price: this.midPrice,
        ts: Date.now(),
        ctx: { obi: this.obi, sigma: this.sigma }
      };
      try {
        const log = JSON.parse(localStorage.getItem('tradeLog') || '[]');
        log.push(entry);
        localStorage.setItem('tradeLog', JSON.stringify(log));
      } catch {}
      console.log(entry);
    }
    this.resetBall(dir === 'LONG' ? 1 : -1);
  }

  resetBall(direction) {
    const h = this.canvas.height;
    this.ballX = (this.leftBoundary() + this.rightBoundary()) / 2;
    this.ballY = Math.random() * (h - this.ballRadius * 2) + this.ballRadius;
    this.vx = direction * this.speed;
    this.vy = (Math.random() * 2 - 1) * this.speed;
  }
}
