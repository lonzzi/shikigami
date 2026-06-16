/** 媒体服务器客户端共享契约。Jellyfin/Emby 实现这个接口。 */
export interface MediaServerClient {
  readonly type: 'jellyfin' | 'emby';
  /** 触发库扫描/条目刷新。tvdbId 缺失时走降级链。 */
  refreshSeries(series: { tvdbId?: number | null; libraryPath?: string | null }): Promise<void>;
  /** 健康检查。 */
  ping(): Promise<boolean>;
}

export interface NfoEpisode {
  title: string;
  season: number;
  episode: number;
  showTitle: string;
  aired?: string;
  plot?: string;
}

export interface NfoShow {
  title: string;
  originaltitle?: string;
  plot?: string;
  premiered?: string;
  studio?: string;
  tvdbid?: string;
  tmdbid?: string;
}
