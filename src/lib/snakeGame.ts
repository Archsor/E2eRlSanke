export type DirectionKey = "w" | "a" | "s" | "d";

export interface GameConfig {
  pixelSize: number;
  gameWidth: number;
  gameHeight: number;
  moveSpeed: number;
}

class Position {
  constructor(public x = 0, public y = 0) {}
  clone() { return new Position(this.x, this.y); }
  equals(other: Position) { return this.x === other.x && this.y === other.y; }
}

class Snake {
  body: Position[];
  direction: Position;
  nextDirection: Position;

  constructor(private config: GameConfig) {
    this.body = [new Position(Math.floor(config.gameWidth / 2), Math.floor(config.gameHeight / 2))];
    this.direction = new Position(1, 0);
    this.nextDirection = new Position(1, 0);
  }

  getHead() { return this.body[0]; }

  setDirection(x: number, y: number) {
    if (this.direction.x + x === 0 && this.direction.y + y === 0) return false;
    this.nextDirection = new Position(x, y);
    return true;
  }

  move() {
    this.direction = this.nextDirection.clone();
    const head = this.getHead();
    const newHead = new Position(head.x + this.direction.x, head.y + this.direction.y);
    this.body.unshift(newHead);
    this.body.pop();
  }

  eatFood() {
    const head = this.getHead();
    this.body.unshift(new Position(head.x, head.y));
  }

  checkWallCollision() {
    const h = this.getHead();
    return h.x < 0 || h.x >= this.config.gameWidth || h.y < 0 || h.y >= this.config.gameHeight;
  }

  checkSelfCollision() {
    const head = this.getHead();
    for (let i = 4; i < this.body.length; i++) {
      if (head.equals(this.body[i])) return true;
    }
    return false;
  }

  reset() {
    this.body = [new Position(Math.floor(this.config.gameWidth / 2), Math.floor(this.config.gameHeight / 2))];
    this.direction = new Position(1, 0);
    this.nextDirection = new Position(1, 0);
  }
}

class Food {
  position: Position;
  constructor(private config: GameConfig) { this.position = this.generatePosition(); }
  generatePosition() {
    return new Position(Math.floor(Math.random() * this.config.gameWidth), Math.floor(Math.random() * this.config.gameHeight));
  }
  getFood() { return this.position; }
  checkCollision(snakeHead: Position) { return snakeHead.equals(this.position); }
  respawn() { this.position = this.generatePosition(); }
}

class Renderer {
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement, private config: GameConfig) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    this.ctx = ctx;
    canvas.width = config.gameWidth * config.pixelSize;
    canvas.height = config.gameHeight * config.pixelSize;
  }

  clear() {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawGrid() {
    this.ctx.strokeStyle = "#222";
    this.ctx.lineWidth = 0.5;
    for (let i = 0; i <= this.config.gameWidth; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * this.config.pixelSize, 0);
      this.ctx.lineTo(i * this.config.pixelSize, this.canvas.height);
      this.ctx.stroke();
    }
    for (let i = 0; i <= this.config.gameHeight; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * this.config.pixelSize);
      this.ctx.lineTo(this.canvas.width, i * this.config.pixelSize);
      this.ctx.stroke();
    }
  }

  drawSnake(snake: Snake) {
    const length = snake.body.length;
    snake.body.forEach((segment, index) => {
      const x = segment.x * this.config.pixelSize;
      const y = segment.y * this.config.pixelSize;
      const val = 0.9 - (index / Math.max(1, length)) * 0.6;
      const gVal = Math.floor(Math.max(0.3, val) * 255);
      this.ctx.fillStyle = `rgb(0, ${gVal}, 0)`;
      this.ctx.fillRect(x + 1, y + 1, this.config.pixelSize - 2, this.config.pixelSize - 2);
    });
  }

  drawFood(food: Food) {
    const x = food.position.x * this.config.pixelSize;
    const y = food.position.y * this.config.pixelSize;
    this.ctx.fillStyle = "rgb(255, 0, 0)";
    this.ctx.fillRect(x + 2, y + 2, this.config.pixelSize - 4, this.config.pixelSize - 4);
  }
}

export class SnakeGame {
  snake: Snake;
  food: Food;
  renderer: Renderer;
  reward = 0;
  done = false;
  gameOver = false;
  score = 0;
  aiMode = false;

  constructor(public config: GameConfig, private canvas: HTMLCanvasElement) {
    this.snake = new Snake(config);
    this.food = new Food(config);
    this.renderer = new Renderer(canvas, config);
    this.render();
  }

  handleAction(action: number) {
    const map: Record<number, DirectionKey> = { 0: "w", 1: "s", 2: "a", 3: "d" };
    this.handleKey(map[action]);
  }

  handleKey(key: DirectionKey) {
    const directionMap: Record<DirectionKey, { x: number; y: number }> = {
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    };
    const dir = directionMap[key];
    this.snake.setDirection(dir.x, dir.y);
  }

  update() {
    this.reward = 0;
    this.done = false;

    const oldHead = this.snake.getHead();
    const oldFood = this.food.getFood();
    const oldDist = Math.abs(oldHead.x - oldFood.x) + Math.abs(oldHead.y - oldFood.y);

    this.snake.move();
    this.reward -= 0.02;

    const newHead = this.snake.getHead();
    const newFood = this.food.getFood();
    const newDist = Math.abs(newHead.x - newFood.x) + Math.abs(newHead.y - newFood.y);
    this.reward += newDist < oldDist ? 0.2 : -0.2;

    if (this.snake.checkWallCollision() || this.snake.checkSelfCollision()) {
      this.gameOver = true;
      this.done = true;
      this.reward -= 10;
      this.reset();
      return;
    }

    if (this.food.checkCollision(this.snake.getHead())) {
      this.snake.eatFood();
      this.food.respawn();
      this.score += 1;
      this.reward += 10 * this.snake.body.length;
    }
  }

  getAuxiliaryFeatures(): number[] {
    const head = this.snake.getHead();
    const food = this.food.getFood();
    const dx = (food.x - head.x) / this.config.gameWidth;
    const dy = (food.y - head.y) / this.config.gameHeight;
    const dist = Math.sqrt(dx ** 2 + dy ** 2);

    const unsafe = (x: number, y: number) => {
      if (x < 0 || x >= this.config.gameWidth || y < 0 || y >= this.config.gameHeight) return 1;
      return this.snake.body.some((s) => s.x === x && s.y === y) ? 1 : 0;
    };

    const surround = [
      unsafe(head.x, head.y - 1),
      unsafe(head.x, head.y + 1),
      unsafe(head.x - 1, head.y),
      unsafe(head.x + 1, head.y),
    ];

    const length = this.snake.body.length / (this.config.gameWidth * this.config.gameHeight);
    return [dx, dy, dist, ...surround, length];
  }

  render() {
    this.renderer.clear();
    this.renderer.drawGrid();
    this.renderer.drawSnake(this.snake);
    this.renderer.drawFood(this.food);
  }

  reset() {
    this.snake.reset();
    this.food = new Food(this.config);
    this.gameOver = false;
    this.score = 0; // 撞墙/重置时将分数清零
    this.render();
  }
}
