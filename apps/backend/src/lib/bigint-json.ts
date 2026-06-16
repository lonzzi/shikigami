/**
 * 全局 BigInt JSON 序列化补丁。
 *
 * Prisma 的 sizeBytes 是 BigInt，原生 JSON.stringify 不能序列化 BigInt，
 * 任何返回 task/mediaFile 的端点都会因 c.json → JSON.stringify 抛错。
 *
 * 补 BigInt.prototype.toJSON：序列化时转为字符串（BigInt 超过 Number.MAX_SAFE_INTEGER，
 * 用字符串避免精度丢失；前端 formatBytes 已处理 string 入参）。
 *
 * 必须在 app/index 之前 import，确保补丁在任何响应序列化前生效。
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return String(this);
};
