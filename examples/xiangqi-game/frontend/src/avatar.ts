// 头像纹章：按玩家 ID 确定性取色，取展示名首字为纹样。
// AI 座位不在此处理（UI 直接用 bot 图标）。

export function hashHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function monogram(name: string): string {
  const chars = [...name.trim()];
  return chars.length > 0 ? chars[0].toUpperCase() : '?';
}

/** 纹章头像配色（深色底 + 同系亮字）。 */
export function avatarStyle(id: string): Record<string, string> {
  const hue = hashHue(id);
  return {
    background: `hsl(${hue} 42% 20%)`,
    color: `hsl(${hue} 78% 76%)`,
    border: `1px solid hsl(${hue} 55% 38% / 0.7)`,
  };
}
