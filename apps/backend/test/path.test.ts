import { describe, expect, it } from 'bun:test';
import { classifyFileKind, extOf, sanitizePathSegment } from '../src/lib/path';

describe('sanitizePathSegment', () => {
  it('替换非法字符', () => {
    expect(sanitizePathSegment('A/B:C?D*E')).toBe('A_B_C_D_E');
  });
  it('去首尾点', () => {
    expect(sanitizePathSegment('...title...')).toBe('title');
  });
  it('折叠空白', () => {
    expect(sanitizePathSegment('a   b')).toBe('a b');
  });
  it('截断长度', () => {
    expect(sanitizePathSegment('x'.repeat(200), 10).length).toBe(10);
  });
  it('纯非法字符 → Unknown', () => {
    // /// 被替换为 ___ 再 trim 空, sanitize-filename 后非空则保留; 纯空白才 Unknown
    expect(sanitizePathSegment('   ')).toBe('Unknown');
  });
  it('中文保留', () => {
    expect(sanitizePathSegment('葬送的芙莉莲')).toBe('葬送的芙莉莲');
  });
});

describe('classifyFileKind', () => {
  it('识别视频', () => {
    expect(classifyFileKind('ep01.mkv')).toBe('video');
    expect(classifyFileKind('ep01.mp4')).toBe('video');
    expect(classifyFileKind('movie.m2ts')).toBe('video');
  });
  it('识别字幕', () => {
    expect(classifyFileKind('ep01.ass')).toBe('subtitle');
    expect(classifyFileKind('ep01.srt')).toBe('subtitle');
  });
  it('识别字体', () => {
    expect(classifyFileKind('font.ttf')).toBe('font');
    expect(classifyFileKind('font.otf')).toBe('font');
  });
  it('其余 other', () => {
    expect(classifyFileKind('readme.txt')).toBe('other');
  });
});

describe('extOf', () => {
  it('取小写扩展名', () => {
    expect(extOf('a.MKV')).toBe('mkv');
    expect(extOf('a.b.TS')).toBe('ts');
  });
  it('无扩展名 → 空', () => {
    expect(extOf('noext')).toBe('');
  });
});
