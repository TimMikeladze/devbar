export type DrawTool = "pen" | "arrow" | "rectangle" | "circle";

export type DrawPoint = { x: number; y: number };

export type DrawShape = {
	tool: DrawTool;
	points: DrawPoint[];
	color: string;
	lineWidth: number;
};

export function renderShape(ctx: CanvasRenderingContext2D, shape: DrawShape): void {
	ctx.strokeStyle = shape.color;
	ctx.lineWidth = shape.lineWidth;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	switch (shape.tool) {
		case "pen":
			renderPen(ctx, shape.points);
			break;
		case "arrow":
			renderArrow(ctx, shape.points);
			break;
		case "rectangle":
			renderRectangle(ctx, shape.points);
			break;
		case "circle":
			renderCircle(ctx, shape.points);
			break;
	}
}

function renderPen(ctx: CanvasRenderingContext2D, points: DrawPoint[]): void {
	if (points.length < 2) return;
	ctx.beginPath();
	ctx.moveTo(points[0]!.x, points[0]!.y);
	for (let i = 1; i < points.length; i++) {
		ctx.lineTo(points[i]!.x, points[i]!.y);
	}
	ctx.stroke();
}

function renderArrow(ctx: CanvasRenderingContext2D, points: DrawPoint[]): void {
	if (points.length < 2) return;
	const start = points[0]!;
	const end = points[points.length - 1]!;

	ctx.beginPath();
	ctx.moveTo(start.x, start.y);
	ctx.lineTo(end.x, end.y);
	ctx.stroke();

	const angle = Math.atan2(end.y - start.y, end.x - start.x);
	const headLen = 16;

	ctx.beginPath();
	ctx.moveTo(end.x, end.y);
	ctx.lineTo(
		end.x - headLen * Math.cos(angle - Math.PI / 6),
		end.y - headLen * Math.sin(angle - Math.PI / 6),
	);
	ctx.moveTo(end.x, end.y);
	ctx.lineTo(
		end.x - headLen * Math.cos(angle + Math.PI / 6),
		end.y - headLen * Math.sin(angle + Math.PI / 6),
	);
	ctx.stroke();
}

function renderRectangle(ctx: CanvasRenderingContext2D, points: DrawPoint[]): void {
	if (points.length < 2) return;
	const start = points[0]!;
	const end = points[points.length - 1]!;
	const x = Math.min(start.x, end.x);
	const y = Math.min(start.y, end.y);
	const w = Math.abs(end.x - start.x);
	const h = Math.abs(end.y - start.y);
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.stroke();
}

function renderCircle(ctx: CanvasRenderingContext2D, points: DrawPoint[]): void {
	if (points.length < 2) return;
	const start = points[0]!;
	const end = points[points.length - 1]!;
	const cx = (start.x + end.x) / 2;
	const cy = (start.y + end.y) / 2;
	const rx = Math.abs(end.x - start.x) / 2;
	const ry = Math.abs(end.y - start.y) / 2;

	ctx.beginPath();
	ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	ctx.stroke();
}
