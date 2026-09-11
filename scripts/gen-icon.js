/**
 * DeekAI 桌面版图标生成脚本（纯 Node，无原生依赖）
 * 设计：绿色渐变圆角方块 + 白色对话气泡（含气泡尾巴）+ 气泡内绿色“AI 律动条”。
 * 产出：build/icon.png(512) 与 build/icon.ico(16/32/48/128/256)
 */
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const SIZE = 512;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** 圆角矩形 SDF（负值在内部） */
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 胶囊 SDF：线段 (x, y0)-(x, y1) 半径 r */
function sdCapsule(px, py, x, y0, y1, r) {
  const cy = clamp(py, y0, y1);
  return Math.hypot(px - x, py - cy) - r;
}

const cov = (d) => clamp(0.5 - d, 0, 1);

function pointInTriangle(px, py, a, b, c) {
  const sign = (p1, p2, p3) =>
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// 配色（网页版主题：#10a37f 系）
const BG_TOP = [26, 183, 137]; // #1ab789
const BG_BOTTOM = [11, 133, 105]; // #0b8569
const WHITE = [255, 255, 255];
const BAR_MAIN = [12, 148, 108]; // #0c946c
const BAR_DEEP = [8, 116, 84]; // #087454

/** 直接以矢量几何光栅化某个尺寸（连续坐标，天然抗锯齿），返回 RGBA 像素图 */
function renderPixels(size) {
  const k = size / SIZE;
  const cx = 256 * k;
  const cy = 256 * k;
  const outerRadius = 112 * k;
  const half = 256 * k;

  // 气泡
  const bubCx = 256 * k;
  const bubCy = 264 * k;
  const bubHw = 168 * k;
  const bubHh = 146 * k;
  const bubR = 46 * k;
  // 气泡尾巴（左下角小三角，顶边埋在气泡内）
  const tail = [
    [128 * k, 394 * k],
    [240 * k, 394 * k],
    [148 * k, 472 * k],
  ];
  // 律动条（垂直胶囊），基线对齐气泡下方
  const bars = [
    { x: 174 * k, top: 152 * k, bottom: 362 * k, w: 42 * k, color: BAR_MAIN },
    { x: 256 * k, top: 112 * k, bottom: 362 * k, w: 42 * k, color: BAR_DEEP },
    { x: 338 * k, top: 176 * k, bottom: 362 * k, w: 42 * k, color: BAR_MAIN },
  ];

  const png = new PNG({ width: size, height: size });
  const data = png.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 采样点用像素坐标（下方几何量已按 k 缩放到像素空间，两者必须同一坐标系）
      const u = x + 0.5;
      const v = y + 0.5;

      // 外框（圆角方块）
      const bgCov = cov(sdRoundBox(u, v, cx, cy, half, half, outerRadius));
      if (bgCov <= 0) continue;

      // 背景垂直渐变
      const t = v / size;
      const bgR = lerp(BG_TOP[0], BG_BOTTOM[0], t);
      const bgG = lerp(BG_TOP[1], BG_BOTTOM[1], t);
      const bgB = lerp(BG_TOP[2], BG_BOTTOM[2], t);

      // 从背景开始做 alpha 混合（premultiplied）
      let A = bgCov;
      let pr = bgR * bgCov;
      let pg = bgG * bgCov;
      let pb = bgB * bgCov;

      const over = (src, sa) => {
        if (sa <= 0) return;
        const na = sa + A * (1 - sa);
        pr = pr * (1 - sa) + src[0] * sa;
        pg = pg * (1 - sa) + src[1] * sa;
        pb = pb * (1 - sa) + src[2] * sa;
        A = na;
      };

      // 白色气泡圆角矩形
      const bubbleCov = cov(sdRoundBox(u, v, bubCx, bubCy, bubHw, bubHh, bubR));
      const tailCov = pointInTriangle(u, v, tail[0], tail[1], tail[2]) ? 1 : 0;
      const whiteCov = clamp(Math.max(bubbleCov, tailCov), 0, 1);
      if (whiteCov > 0) over(WHITE, whiteCov);

      // 绿色律动条（压在气泡上）
      for (const bar of bars) {
        const barCov = cov(
          sdCapsule(u, v, bar.x, bar.top, bar.bottom, bar.w / 2)
        );
        if (barCov > 0) over(bar.color, barCov);
      }

      if (A > 0) {
        const idx = (y * size + x) * 4;
        data[idx] = clamp(Math.round(pr / A), 0, 255);
        data[idx + 1] = clamp(Math.round(pg / A), 0, 255);
        data[idx + 2] = clamp(Math.round(pb / A), 0, 255);
        data[idx + 3] = clamp(Math.round(A * 255), 0, 255);
      }
    }
  }

  return png;
}

/** 生成某尺寸的 PNG 字节流 */
function renderPng(size) {
  return PNG.sync.write(renderPixels(size));
}

/**
 * 生成某尺寸的 ICO 内嵌图（BITMAPINFOHEADER + 32bpp BGRA + AND 掩码）。
 * 注意：必须用 BMP(DIB) 而不能用 PNG 压缩条目——后者在 Windows 资源写入/GDI+ 下兼容性差，
 * 会导致打包出的 exe 图标为空。
 */
function renderIcoBitmap(size) {
  const rgba = renderPixels(size).data;
  const rowSize = size * 4;
  const andRowSize = Math.ceil(size / 8 / 4) * 4; // 1bpp，行按 4 字节对齐
  const xorSize = rowSize * size;
  const andSize = andRowSize * size;
  const dib = Buffer.alloc(40 + xorSize + andSize);

  dib.writeUInt32LE(40, 0); // biSize
  dib.writeInt32LE(size, 4); // biWidth
  dib.writeInt32LE(size * 2, 8); // biHeight：XOR + AND 两张图，故为 2 倍
  dib.writeUInt16LE(1, 12); // biPlanes
  dib.writeUInt16LE(32, 14); // biBitCount
  dib.writeUInt32LE(0, 16); // biCompression = BI_RGB
  dib.writeUInt32LE(xorSize + andSize, 20); // biSizeImage
  // 24~39 字节（分辨率、调色板数）保持 0

  const xorOff = 40;
  const andOff = 40 + xorSize;

  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y; // DIB 自下而上存储
    for (let x = 0; x < size; x++) {
      const s = (srcY * size + x) * 4;
      const d = xorOff + y * rowSize + x * 4;
      dib[d] = rgba[s + 2]; // B
      dib[d + 1] = rgba[s + 1]; // G
      dib[d + 2] = rgba[s]; // R
      dib[d + 3] = rgba[s + 3]; // A（非预乘）
      if (rgba[s + 3] === 0) {
        dib[andOff + y * andRowSize + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return dib;
}

/** 组装 ICO：ICONDIR + 多个 ICONDIRENTRY */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + 16 * entries.length;
  const parts = [];
  for (const { size, data } of entries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 表示 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    parts.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...parts, ...entries.map((e) => e.data)]);
}

function main() {
  const buildDir = path.join(__dirname, "..", "build");
  fs.mkdirSync(buildDir, { recursive: true });

  // 主图标 PNG（512，用于 dev 窗口）
  const icon512 = renderPng(512);
  fs.writeFileSync(path.join(buildDir, "icon.png"), icon512);

  // 多尺寸 ICO（Windows 安装包 / exe 图标）
  const sizes = [16, 32, 48, 128, 256];
  const ico = buildIco(
    sizes.map((size) => ({ size, data: renderIcoBitmap(size) }))
  );
  fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);

  console.log("icon.png  ", icon512.length, "bytes");
  for (const s of sizes) {
    console.log(`icon.ico -> ${s}px entry ${renderIcoBitmap(s).length} bytes`);
  }
  console.log("icon.ico  ", ico.length, "bytes");
  console.log("生成完成: build/icon.png, build/icon.ico");
}

main();
